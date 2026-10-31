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
import { concurrency, TtlCache } from '../cache';
import { ElasticUnavailableError, ReadOnlyElasticClient } from './http';
import {
	agentKuery,
	agentPolicyKuery,
	alertAggregatesBody,
	alertByIdBody,
	alertCountsByAgentBody,
	alertSearchBody,
	FLEET_SORT_FIELDS,
	kqlAnyOf,
	ruleIdsBody,
	unseenVersionKuery
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

const MINUTE = 60_000;
/**
 * How long reference data is reused. Live data (agent lists, status counts,
 * alerts) is never cached, so "Refresh" always shows the current state.
 */
const TTL = {
	/** Policy names: renamed rarely. */
	policies: 5 * MINUTE,
	/** Versions Fleet can upgrade to: change with Elastic releases. */
	versions: 60 * MINUTE,
	/** Version and tag filter options: change on upgrades and retagging. */
	facets: 5 * MINUTE,
	/** Detection rule names: renamed rarely. */
	ruleNames: 5 * MINUTE,
	/** Best-effort lookups that failed are retried after this. */
	failedLookup: MINUTE
};

/** Upper bound on distinct agent versions listed in the version filter. */
const MAX_VERSIONS = 50;

/** Cache key prefix per tenant scope. */
const scopeKey = (s: TenantScope) => `${s.id}|${s.spaceId}|${s.agentPolicyIds.join(',')}`;

/**
 * Real data source: Kibana Fleet + Endpoint APIs (space-scoped URLs) for
 * agents, and the space's alerts-as-data alias for detections. Authenticates
 * with the tenant-specific read-only API key from the container config.
 */
export class ElasticDataSource implements DataSource {
	readonly kind = 'elastic' as const;
	private client: ReadOnlyElasticClient;
	private cache = new TtlCache();
	/** A detections page can name up to 200 rules; look them up a few at a time. */
	private ruleLookups = concurrency(4);

	constructor(cfg: ElasticConfig) {
		this.client = new ReadOnlyElasticClient(cfg);
	}

	private space(scope: TenantScope) {
		return scope.spaceId === 'default' ? '' : `/s/${scope.spaceId}`;
	}

	async listAgents(
		scope: TenantScope,
		q: AgentQuery,
		{ metrics = true } = {}
	): Promise<RawFleetAgentList> {
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
				// CPU/memory cost Fleet an extra metrics query; only lists that show them ask.
				withMetrics: metrics || undefined
			}
		);
		return res ?? { items: [], total: 0, page: q.page, perPage: q.pageSize };
	}

	async getAgent(scope: TenantScope, agentId: string): Promise<RawFleetAgent | null> {
		if (!/^[A-Za-z0-9-]{1,64}$/.test(agentId)) return null;
		// withMetrics: Fleet only includes CPU/memory when asked (as in the list call).
		const res = await this.client.kibanaGet<{ item: RawFleetAgent }>(
			`${this.space(scope)}/api/fleet/agents/${agentId}`,
			{ withMetrics: true }
		);
		// Portal checks the agent's policy.
		return res?.item ?? null;
	}

	async agentStatus(scope: TenantScope): Promise<RawFleetAgentStatus> {
		const res = await this.client.kibanaGet<RawFleetAgentStatus>(
			`${this.space(scope)}/api/fleet/agent_status`,
			{
				kuery: agentPolicyKuery(scope)
			}
		);
		// Counts always exist; a 404 means a missing space, not an empty fleet.
		if (!res) throw new ElasticUnavailableError('kibana agent_status not found', 404);
		return res;
	}

	agentPolicies(scope: TenantScope): Promise<RawAgentPolicy[]> {
		return this.cache.get(`policies|${scopeKey(scope)}`, TTL.policies, async () => {
			const res = await this.client.kibanaGet<{ items: RawAgentPolicy[] }>(
				`${this.space(scope)}/api/fleet/agent_policies`,
				// No kuery: its saved-object field name differs between Fleet versions
				// (space-aware Fleet matches nothing on `ingest-agent-policies.id`).
				// The space-scoped list is filtered to the tenant's policies below.
				{ perPage: 100, full: false }
			);
			return (res?.items ?? []).filter((p) => scope.agentPolicyIds.includes(p.id));
		});
	}

	/** Version and tag filter options. Tags come from Fleet's tags API (a terms aggregation). */
	agentFacetValues(scope: TenantScope): Promise<{ versions: string[]; tags: string[] }> {
		return this.cache.get(`facets|${scopeKey(scope)}`, TTL.facets, async () => {
			const [versions, tags] = await Promise.all([
				this.agentVersions(scope),
				this.client.kibanaGet<{ items: string[] }>(`${this.space(scope)}/api/fleet/agents/tags`, {
					kuery: agentPolicyKuery(scope),
					showInactive: true
				})
			]);
			return { versions, tags: tags?.items ?? [] };
		});
	}

	/**
	 * Distinct agent versions. Fleet's API has no aggregation for them, so ask for
	 * one agent with a version not seen yet until none is left: one small request
	 * per version.
	 */
	private async agentVersions(scope: TenantScope): Promise<string[]> {
		const versions: string[] = [];
		while (versions.length < MAX_VERSIONS) {
			const res = await this.client.kibanaGet<RawFleetAgentList>(
				`${this.space(scope)}/api/fleet/agents`,
				{
					kuery: unseenVersionKuery(scope, versions),
					perPage: 1,
					showInactive: true,
					showAgentless: false,
					sortField: FLEET_SORT_FIELDS.agentVersion,
					sortOrder: 'desc'
				}
			);
			const v = res?.items[0]?.local_metadata?.elastic?.agent?.version;
			// A repeat would mean Fleet ignored the filter: stop rather than loop.
			if (!v || versions.includes(v)) break;
			versions.push(v);
		}
		return versions;
	}

	async agentStatusSummary(scope: TenantScope, q: AgentQuery) {
		const res = await this.client.kibanaGet<RawFleetAgentList>(
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

	availableVersions(scope: TenantScope): Promise<string[]> {
		return this.cache.get(
			`versions|${scopeKey(scope)}`,
			TTL.versions,
			async () => {
				// Space-scoped path: the tenant API key only has privileges in its own space.
				const res = await this.client.kibanaGet<{ items: string[] }>(
					`${this.space(scope)}/api/fleet/agents/available_versions`
				);
				return res?.items ?? [];
			},
			TTL.failedLookup
		);
	}

	async endpointMetadata(scope: TenantScope, agentIds: string[]) {
		if (agentIds.length === 0) return [];
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
		const res = await this.client.esSearch<RawSearchResponse>(
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
		return this.cache.get(
			`rule|${scope.spaceId}|${ruleUuid}`,
			TTL.ruleNames,
			() =>
				this.ruleLookups(async () => {
					const rule = await this.client.kibanaGet<{ name?: string }>(
						`${this.space(scope)}/api/detection_engine/rules`,
						{ id: ruleUuid }
					);
					return rule?.name;
				}),
			TTL.failedLookup
		);
	}

	async getAlert(scope: TenantScope, alertId: string): Promise<RawAlertHit | null> {
		const res = await this.client.esSearch<RawSearchResponse>(
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
		const res = await this.client.esSearch<RawSearchResponse<Aggs>>(
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
		const res = await this.client.esSearch<RawSearchResponse<Aggs>>(
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
		const res = await this.client.esSearch<RawSearchResponse<{ rules: Terms }>>(
			scope.alertsIndex,
			ruleIdsBody(scope, range)
		);
		return (res?.aggregations?.rules.buckets ?? []).map((b) => b.key);
	}

	async ping(): Promise<void> {
		// A 404 here means a wrong KIBANA_URL, not a ready Kibana.
		if (!(await this.client.kibanaGet('/api/status')))
			throw new ElasticUnavailableError('kibana /api/status not found', 404);
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
