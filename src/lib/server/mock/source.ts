import type {
	AgentQuery,
	AlertCounts,
	AlertQuery,
	Severity,
	TimeRange,
	WorkflowStatus
} from '#lib/contract.ts';
import type { TenantScope } from '../config';
import type { AlertAggregates, AlertSearchResult, DataSource } from '../datasource/types';
import { LIMITS } from '../datasource/types';
import { field, str, strList, type RawAlertHit, type RawFleetAgent } from '../elastic/raw';
import { alertKind, alertOutcome, ALERT_SOURCE_FIELDS } from '../normalize/alerts';
import { buildMockWorld, MOCK_AVAILABLE_VERSIONS, type MockWorld } from './world';
import { compareVersions } from '../normalize/agents';

/**
 * In-memory stand-in for Fleet, the Endpoint API and the alerts index, built
 * on SYNTHETIC data. It applies tenant scope the same way the real queries do
 * (policy filter for agents; alias + space + namespace for alerts) so the
 * service-layer isolation checks are exercised end to end.
 */
export class MockDataSource implements DataSource {
	readonly kind = 'mock' as const;

	constructor(private world: MockWorld = buildMockWorld()) {}

	// ---- agents ------------------------------------------------------------

	private scopedAgents(scope: TenantScope): RawFleetAgent[] {
		return this.world.agents.filter(
			(a) => a.active && a.policy_id && scope.agentPolicyIds.includes(a.policy_id)
		);
	}

	/** Mock equivalent of the Fleet kuery + `showUpgradeable` built in `elastic/queries.ts`. */
	private filterAgents(scope: TenantScope, q: AgentQuery, withStatus = true): RawFleetAgent[] {
		let rows = this.scopedAgents(scope);
		if (q.search) {
			const s = q.search.toLowerCase();
			rows = rows.filter(
				(a) =>
					a.local_metadata?.host?.hostname?.toLowerCase().includes(s) ||
					a.id.toLowerCase().includes(s)
			);
		}
		if (withStatus && q.statuses?.length)
			rows = rows.filter((a) => q.statuses!.includes(a.status as never));
		if (q.versions?.length)
			rows = rows.filter((a) =>
				q.versions!.includes(a.local_metadata?.elastic?.agent?.version ?? '')
			);
		if (q.tags?.length) rows = rows.filter((a) => a.tags?.some((t) => q.tags!.includes(t)));
		if (q.policyIds?.length) rows = rows.filter((a) => q.policyIds!.includes(a.policy_id ?? ''));
		if (q.upgradeAvailable) {
			const latest = MOCK_AVAILABLE_VERSIONS[0];
			rows = rows.filter((a) => {
				const v = a.local_metadata?.elastic?.agent?.version;
				return !!v && compareVersions(v, latest) < 0 && a.status === 'online';
			});
		}
		return rows;
	}

	async listAgents(scope: TenantScope, q: AgentQuery) {
		let rows = this.filterAgents(scope, q);
		const key = (a: RawFleetAgent): string => {
			switch (q.sort) {
				case 'lastCheckin':
					return a.last_checkin ?? '';
				case 'enrolledAt':
					return a.enrolled_at ?? '';
				case 'policy':
					return a.policy_id ?? '';
				case 'agentVersion':
					return (a.local_metadata?.elastic?.agent?.version ?? '').replace(/\d+/g, (d) =>
						d.padStart(4, '0')
					);
				default:
					return (a.local_metadata?.host?.hostname ?? '').toLowerCase();
			}
		};
		rows = [...rows].sort((a, b) => key(a).localeCompare(key(b)) * (q.dir === 'asc' ? 1 : -1));
		const start = (q.page - 1) * q.pageSize;
		return {
			items: structuredClone(rows.slice(start, start + q.pageSize)),
			total: rows.length,
			page: q.page,
			perPage: q.pageSize
		};
	}

	async getAgent(scope: TenantScope, agentId: string) {
		const a = this.scopedAgents(scope).find((x) => x.id === agentId);
		return a ? structuredClone(a) : null;
	}

	async agentStatus(scope: TenantScope) {
		const r = {
			online: 0,
			error: 0,
			offline: 0,
			updating: 0,
			inactive: 0,
			unenrolled: 0,
			degraded: 0,
			enrolling: 0,
			unenrolling: 0,
			orphaned: 0,
			uninstalled: 0,
			all: 0,
			active: 0,
			other: 0,
			events: 0
		};
		for (const a of this.scopedAgents(scope)) {
			const s = (a.status ?? 'error') as keyof typeof r;
			if (s in r) r[s]++;
			r.all++;
			if (s !== 'inactive' && s !== 'unenrolled') r.active++;
		}
		// Fleet's agent_status API folds `degraded` into `error`.
		r.error += r.degraded;
		r.updating += r.enrolling + r.unenrolling;
		return { results: r };
	}

	async agentPolicies(scope: TenantScope) {
		return this.world.policies.filter((p) => scope.agentPolicyIds.includes(p.id));
	}

	async agentFacetValues(scope: TenantScope) {
		const agents = this.scopedAgents(scope);
		const versions = new Set<string>();
		const tags = new Set<string>();
		for (const a of agents) {
			const v = a.local_metadata?.elastic?.agent?.version;
			if (v) versions.add(v);
			for (const t of a.tags ?? []) tags.add(t);
		}
		return { versions: [...versions], tags: [...tags].sort() };
	}

	async agentStatusSummary(scope: TenantScope, q: AgentQuery) {
		const out: Record<string, number> = {};
		for (const a of this.filterAgents(scope, q, false)) {
			const st = a.status ?? 'error';
			out[st] = (out[st] ?? 0) + 1;
		}
		return out;
	}

	async availableVersions(_scope: TenantScope) {
		return [...MOCK_AVAILABLE_VERSIONS];
	}

	async endpointMetadata(scope: TenantScope, agentIds: string[]) {
		const allowed = new Set(this.scopedAgents(scope).map((a) => a.id));
		return agentIds
			.filter((id) => allowed.has(id))
			.map((id) => this.world.endpointMetadata.get(id))
			.filter((m) => m !== undefined)
			.map((m) => structuredClone(m));
	}

	// ---- alerts ------------------------------------------------------------

	/** Equivalent of the mandatory filter in `elastic/queries.ts#alertScopeFilter`. */
	private scopedAlerts(scope: TenantScope, range?: TimeRange): RawAlertHit[] {
		const hits = this.world.alertIndices.get(scope.alertsIndex) ?? [];
		return hits.filter((h) => {
			const s = h._source;
			if (!strList(s, 'kibana.space_ids').includes(scope.spaceId)) return false;
			if (!scope.namespaces.includes(str(s, 'data_stream.namespace') ?? '')) return false;
			if (range) {
				const ts = str(s, '@timestamp') ?? '';
				if (ts < range.from || ts > range.to) return false;
			}
			return true;
		});
	}

	private matches(h: RawAlertHit, q: AlertQuery): boolean {
		const s = h._source;
		if (q.severities?.length && !q.severities.includes(str(s, 'kibana.alert.severity') as Severity))
			return false;
		if (
			q.statuses?.length &&
			!q.statuses.includes((str(s, 'kibana.alert.workflow_status') ?? 'open') as never)
		)
			return false;
		if (q.kinds?.length && !q.kinds.includes(alertKind(s))) return false;
		if (q.ruleIds?.length && !q.ruleIds.includes(str(s, 'kibana.alert.rule.uuid') ?? ''))
			return false;
		if (q.agentId && str(s, 'agent.id') !== q.agentId) return false;
		if (q.hostname && str(s, 'host.name')?.toLowerCase() !== q.hostname.toLowerCase()) return false;
		if (q.search) {
			const needle = q.search.toLowerCase();
			const hay = [
				'host.name',
				'user.name',
				'kibana.alert.rule.name',
				'rule.name',
				'file.name',
				'process.name',
				'file.hash.sha256',
				'message'
			];
			if (!hay.some((f) => str(s, f)?.toLowerCase().includes(needle))) return false;
		}
		return true;
	}

	async searchAlerts(scope: TenantScope, q: AlertQuery): Promise<AlertSearchResult> {
		const rows = this.scopedAlerts(scope, q.range).filter((h) => this.matches(h, q));
		const sevRank = (h: RawAlertHit) => Number(field(h._source, 'kibana.alert.risk_score') ?? 0);
		const key = (h: RawAlertHit): string | number => {
			switch (q.sort) {
				case 'severity':
					return sevRank(h);
				case 'ruleName':
					return str(h._source, 'kibana.alert.rule.name') ?? '';
				case 'hostname':
					return str(h._source, 'host.name') ?? '';
				case 'status':
					return str(h._source, 'kibana.alert.workflow_status') ?? '';
				default:
					return str(h._source, '@timestamp') ?? '';
			}
		};
		const sorted = [...rows].sort((a, b) => {
			const ka = key(a);
			const kb = key(b);
			const c = typeof ka === 'number' ? ka - (kb as number) : ka.localeCompare(kb as string);
			return (
				(c || String(b._source['@timestamp']).localeCompare(String(a._source['@timestamp']))) *
				(q.dir === 'asc' ? 1 : -1)
			);
		});
		const start = (q.page - 1) * q.pageSize;
		return {
			hits: sorted.slice(start, start + q.pageSize).map(project),
			total: Math.min(rows.length, LIMITS.maxResultWindow),
			totalIsLowerBound: rows.length > LIMITS.maxResultWindow
		};
	}

	async getAlert(scope: TenantScope, alertId: string) {
		const h = this.scopedAlerts(scope).find((x) => str(x._source, 'kibana.alert.uuid') === alertId);
		return h ? project(h) : null;
	}

	async detectionRuleName(scope: TenantScope, ruleUuid: string) {
		return this.world.rules.get(scope.spaceId)?.find((r) => r.uuid === ruleUuid)?.name;
	}

	async alertAggregates(scope: TenantScope, range: TimeRange): Promise<AlertAggregates> {
		const rows = this.scopedAlerts(scope, range);
		const agg: AlertAggregates = {
			total: rows.length,
			bySeverity: {},
			activeBySeverity: {},
			byStatus: {},
			prevented: 0,
			recentHighPriority: []
		};
		for (const h of rows) {
			const s = h._source;
			const sev = str(s, 'kibana.alert.severity') as Severity;
			const status = (str(s, 'kibana.alert.workflow_status') ?? 'open') as WorkflowStatus;
			agg.bySeverity[sev] = (agg.bySeverity[sev] ?? 0) + 1;
			agg.byStatus[status] = (agg.byStatus[status] ?? 0) + 1;
			if (status !== 'closed') agg.activeBySeverity[sev] = (agg.activeBySeverity[sev] ?? 0) + 1;
			if (alertOutcome(s) === 'prevented') agg.prevented++;
		}
		agg.recentHighPriority = rows
			.filter(
				(h) =>
					['high', 'critical'].includes(str(h._source, 'kibana.alert.severity') ?? '') &&
					str(h._source, 'kibana.alert.workflow_status') !== 'closed'
			)
			.slice(0, 5)
			.map(project);
		return agg;
	}

	async alertCountsByAgent(scope: TenantScope, agentIds: string[]) {
		const wanted = new Set(agentIds);
		const out = new Map<string, AlertCounts>();
		for (const h of this.scopedAlerts(scope)) {
			const id = str(h._source, 'agent.id');
			if (!id || !wanted.has(id)) continue;
			const c = out.get(id) ?? { open: 0, acknowledged: 0, closed: 0, total: 0 };
			const st = (str(h._source, 'kibana.alert.workflow_status') ?? 'open') as keyof AlertCounts;
			c[st]++;
			c.total++;
			out.set(id, c);
		}
		return out;
	}

	async alertRuleIds(scope: TenantScope, range: TimeRange) {
		return [
			...new Set(
				this.scopedAlerts(scope, range)
					.map((h) => str(h._source, 'kibana.alert.rule.uuid'))
					.filter(Boolean) as string[]
			)
		].sort();
	}

	async ping() {}
}

/** Emulates `_source.includes` filtering with the alert field allowlist. */
function project(hit: RawAlertHit): RawAlertHit {
	const out: Record<string, unknown> = {};
	for (const f of ALERT_SOURCE_FIELDS) {
		const v = field(hit._source, f);
		if (v !== undefined) out[f] = structuredClone(v);
	}
	return { _id: hit._id, _index: hit._index, _source: out };
}
