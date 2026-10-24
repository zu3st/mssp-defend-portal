import type {
	AgentQuery,
	AlertCounts,
	AlertQuery,
	Severity,
	TimeRange,
	WorkflowStatus
} from '#lib/contract.ts';
import type { ElasticConfig, TenantScope } from '../config';
import type { AlertAggregates, AlertSearchResult, DataSource } from '../datasource/types';
import { ReadOnlyElasticClient } from './http';
import {
	agentKuery,
	agentPolicyKuery,
	alertAggregatesBody,
	alertByIdBody,
	alertCountsByAgentBody,
	alertSearchBody,
	FLEET_SORT_FIELDS,
	kqlAnyOf,
	ruleIdsBody
} from './queries';
import type {
	RawAgentPolicy,
	RawAlertHit,
	RawEndpointMetadataList,
	RawFleetAgent,
	RawFleetAgentList,
	RawFleetAgentStatus,
	RawSearchResponse
} from './raw';

interface Bucket {
	key: string;
	key_as_string?: string;
	doc_count: number;
}
interface Terms {
	buckets: Bucket[];
}

/**
 * Real data source: Kibana Fleet + Endpoint APIs (space-scoped URLs) for
 * agents, and the space's alerts-as-data alias for detections. Authenticates
 * with the tenant-specific read-only API key from the container config.
 */
export class ElasticDataSource implements DataSource {
	readonly kind = 'elastic' as const;
	private client: ReadOnlyElasticClient;
	private ruleNameCache = new Map<string, { at: number; name?: string }>();
	private facetCache?: {
		at: number;
		scopeKey: string;
		values: { versions: string[]; tags: string[] };
	};

	constructor(cfg: ElasticConfig) {
		this.client = new ReadOnlyElasticClient(cfg);
	}

	private space(scope: TenantScope) {
		return scope.spaceId === 'default' ? '' : `/s/${scope.spaceId}`;
	}

	async listAgents(scope: TenantScope, q: AgentQuery): Promise<RawFleetAgentList> {
		const res = await this.client.kibanaGet<RawFleetAgentList>(
			`${this.space(scope)}/api/fleet/agents`,
			{
				kuery: agentKuery(scope, q),
				page: q.page,
				perPage: q.pageSize,
				sortField: FLEET_SORT_FIELDS[q.sort],
				sortOrder: q.dir,
				showInactive: true,
				showAgentless: false,
				showUpgradeable: q.upgradeAvailable || undefined,
				withMetrics: true
			}
		);
		return res ?? { items: [], total: 0, page: q.page, perPage: q.pageSize };
	}

	async getAgent(scope: TenantScope, agentId: string): Promise<RawFleetAgent | null> {
		if (!/^[A-Za-z0-9-]{1,64}$/.test(agentId)) return null;
		// withMetrics: Fleet only includes CPU/memory when asked (as in the list call).
		const res = await this.client.kibanaGet<{ item: RawFleetAgent } | null>(
			`${this.space(scope)}/api/fleet/agents/${agentId}`,
			{ withMetrics: true }
		);
		// The service layer re-checks the policy; returning it here is safe.
		return res?.item ?? null;
	}

	async agentStatus(scope: TenantScope): Promise<RawFleetAgentStatus> {
		return this.client.kibanaGet<RawFleetAgentStatus>(
			`${this.space(scope)}/api/fleet/agent_status`,
			{
				kuery: agentPolicyKuery(scope)
			}
		);
	}

	async agentPolicies(scope: TenantScope): Promise<RawAgentPolicy[]> {
		const res = await this.client.kibanaGet<{ items: RawAgentPolicy[] }>(
			`${this.space(scope)}/api/fleet/agent_policies`,
			// No kuery: its saved-object field name differs between Fleet versions
			// (space-aware Fleet matches nothing on `ingest-agent-policies.id`).
			// The space-scoped list is filtered to the tenant's policies below.
			{ perPage: 100, full: false }
		);
		return (res?.items ?? []).filter((p) => scope.agentPolicyIds.includes(p.id));
	}

	/**
	 * Fleet has no "distinct versions" API, so page through the tenant's agents
	 * (bounded) and cache the result briefly. Tags come from Fleet's tags API.
	 */
	async agentFacetValues(scope: TenantScope): Promise<{ versions: string[]; tags: string[] }> {
		const scopeKey = scope.agentPolicyIds.join(',');
		if (
			this.facetCache &&
			this.facetCache.scopeKey === scopeKey &&
			Date.now() - this.facetCache.at < 60_000
		) {
			return this.facetCache.values;
		}
		const versions = new Set<string>();
		for (let page = 1; page <= 5; page++) {
			const res = await this.listAgents(scope, {
				sort: 'hostname',
				dir: 'asc',
				page,
				pageSize: 1000
			} as AgentQuery);
			for (const a of res.items) {
				const v = a.local_metadata?.elastic?.agent?.version;
				if (v) versions.add(v);
			}
			if (page * 1000 >= res.total) break;
		}
		const tags = await this.client.kibanaGet<{ items: string[] } | null>(
			`${this.space(scope)}/api/fleet/agents/tags`,
			{ kuery: agentPolicyKuery(scope), showInactive: true }
		);
		const values = { versions: [...versions], tags: tags?.items ?? [] };
		this.facetCache = { at: Date.now(), scopeKey, values };
		return values;
	}

	async agentStatusSummary(scope: TenantScope, q: AgentQuery) {
		// NOTE: verify `getStatusSummary` on the lab version (Fleet 8.16+).
		const res = await this.client.kibanaGet<RawFleetAgentList | null>(
			`${this.space(scope)}/api/fleet/agents`,
			{
				kuery: agentKuery(scope, { ...q, statuses: undefined }),
				perPage: 1,
				showInactive: true,
				showAgentless: false,
				showUpgradeable: q.upgradeAvailable || undefined,
				getStatusSummary: true
			}
		);
		return res?.statusSummary ?? {};
	}

	async availableVersions(scope: TenantScope): Promise<string[]> {
		// Space-scoped path: the tenant API key only has privileges in its own space.
		const res = await this.client.kibanaGet<{ items: string[] } | null>(
			`${this.space(scope)}/api/fleet/agents/available_versions`
		);
		return res?.items ?? [];
	}

	async endpointMetadata(scope: TenantScope, agentIds: string[]) {
		if (agentIds.length === 0) return [];
		// NOTE: verify the `united.*` kuery field names against the lab version.
		const res = await this.client.kibanaGet<RawEndpointMetadataList>(
			`${this.space(scope)}/api/endpoint/metadata`,
			{
				page: 0,
				pageSize: Math.min(agentIds.length, 10_000),
				kuery: `(${kqlAnyOf('united.agent.policy_id', scope.agentPolicyIds)}) and (${kqlAnyOf('united.endpoint.agent.id', agentIds)})`
			}
		);
		return res?.data ?? [];
	}

	async searchAlerts(scope: TenantScope, q: AlertQuery): Promise<AlertSearchResult> {
		const res = await this.client.esSearch<RawSearchResponse | null>(
			scope.alertsIndex,
			alertSearchBody(scope, q)
		);
		if (!res) return { hits: [], total: 0, totalIsLowerBound: false };
		return {
			hits: res.hits.hits,
			total: res.hits.total.value,
			totalIsLowerBound: res.hits.total.relation === 'gte'
		};
	}

	/**
	 * Detection rules are space-scoped, so looking a uuid up in the tenant's space
	 * cannot resolve another customer's rule. Cached: rule names rarely change.
	 */
	async detectionRuleName(scope: TenantScope, ruleUuid: string): Promise<string | undefined> {
		if (!/^[A-Za-z0-9-]{1,64}$/.test(ruleUuid)) return undefined;
		const key = `${scope.spaceId}|${ruleUuid}`;
		const hit = this.ruleNameCache.get(key);
		if (hit && Date.now() - hit.at < 300_000) return hit.name;
		const rule = await this.client.kibanaGet<{ name?: string } | null>(
			`${this.space(scope)}/api/detection_engine/rules`,
			{ id: ruleUuid }
		);
		this.ruleNameCache.set(key, { at: Date.now(), name: rule?.name });
		if (this.ruleNameCache.size > 1000) this.ruleNameCache.clear();
		return rule?.name;
	}

	async getAlert(scope: TenantScope, alertId: string): Promise<RawAlertHit | null> {
		const res = await this.client.esSearch<RawSearchResponse | null>(
			scope.alertsIndex,
			alertByIdBody(scope, alertId)
		);
		return res?.hits.hits[0] ?? null;
	}

	async alertAggregates(scope: TenantScope, range: TimeRange): Promise<AlertAggregates> {
		type Aggs = {
			severity: Terms;
			status: Terms;
			active: { severity: Terms; recent: { top: { hits: { hits: RawAlertHit[] } } } };
			prevented: { doc_count: number };
		};
		const res = await this.client.esSearch<RawSearchResponse<Aggs> | null>(
			scope.alertsIndex,
			alertAggregatesBody(scope, range)
		);
		return parseAggregates(res);
	}

	async alertCountsByAgent(
		scope: TenantScope,
		agentIds: string[]
	): Promise<Map<string, AlertCounts>> {
		const out = new Map<string, AlertCounts>();
		if (agentIds.length === 0) return out;
		type Aggs = { agents: { buckets: (Bucket & { status: Terms })[] } };
		const res = await this.client.esSearch<RawSearchResponse<Aggs> | null>(
			scope.alertsIndex,
			alertCountsByAgentBody(scope, agentIds)
		);
		for (const b of res?.aggregations?.agents.buckets ?? []) {
			const c: AlertCounts = { open: 0, acknowledged: 0, closed: 0, total: b.doc_count };
			for (const s of b.status.buckets) if (s.key in c) c[s.key as WorkflowStatus] = s.doc_count;
			out.set(b.key, c);
		}
		return out;
	}

	async alertRuleIds(scope: TenantScope, range: TimeRange): Promise<string[]> {
		const res = await this.client.esSearch<RawSearchResponse<{ rules: Terms }> | null>(
			scope.alertsIndex,
			ruleIdsBody(scope, range)
		);
		return (res?.aggregations?.rules.buckets ?? []).map((b) => b.key);
	}

	async ping(): Promise<void> {
		await this.client.kibanaGet('/api/status');
	}
}

function parseAggregates(
	res: RawSearchResponse<{
		severity: Terms;
		status: Terms;
		active: { severity: Terms; recent: { top: { hits: { hits: RawAlertHit[] } } } };
		prevented: { doc_count: number };
	}> | null
): AlertAggregates {
	const empty: AlertAggregates = {
		total: 0,
		bySeverity: {},
		activeBySeverity: {},
		byStatus: {},
		prevented: 0,
		recentHighPriority: []
	};
	const a = res?.aggregations;
	if (!res || !a) return empty;
	const toRecord = <K extends string>(t: Terms) =>
		Object.fromEntries(t.buckets.map((b) => [b.key, b.doc_count])) as Partial<Record<K, number>>;
	return {
		total: res.hits.total.value,
		bySeverity: toRecord<Severity>(a.severity),
		activeBySeverity: toRecord<Severity>(a.active.severity),
		byStatus: toRecord<WorkflowStatus>(a.status),
		prevented: a.prevented.doc_count,
		recentHighPriority: a.active.recent.top.hits.hits
	};
}
