import type {
	AgentDetail,
	AgentFacets,
	AgentPage,
	AgentQuery,
	AgentSummary,
	AlertDetail,
	AlertFacets,
	AlertQuery,
	AlertStats,
	AlertSummary,
	FleetStatus,
	FleetStatusCounts,
	FleetStatusGroup,
	Overview,
	Page,
	PolicyStatus,
	Severity,
	TimeRange
} from '#lib/contract.ts';
import type { TenantScope } from './config';
import type { DataSource } from './datasource/types';
import { LIMITS } from './datasource/types';
import {
	str,
	strList,
	type RawAlertHit,
	type RawEndpointMetadata,
	type RawFleetAgent
} from './elastic/raw';
import {
	agentRow,
	compareVersions,
	fleetStatusGroup,
	normalizeAgent,
	normalizeAgentDetail,
	type AgentContext
} from './normalize/agents';
import { normalizeAlertDetail, normalizeAlertSummary } from './normalize/alerts';

/**
 * Raised when a data source returns a record outside the tenant scope. This
 * indicates a bug or misconfiguration upstream; we fail closed and return
 * nothing rather than filtering silently.
 */
export class ScopeViolationError extends Error {}

/** Raw Fleet status counts -> the statuses Kibana Fleet displays. */
function groupCounts(raw: Partial<Record<string, number>>): FleetStatusCounts {
	const out: Record<FleetStatusGroup, number> = {
		healthy: 0,
		unhealthy: 0,
		orphaned: 0,
		updating: 0,
		offline: 0,
		inactive: 0,
		unenrolled: 0,
		uninstalled: 0
	};
	for (const [status, n] of Object.entries(raw)) {
		if (n) out[fleetStatusGroup(status as FleetStatus)] += n;
	}
	const total = out.healthy + out.unhealthy + out.orphaned + out.updating + out.offline;
	return { ...out, total };
}

/**
 * Tenant-bound facade used by all routes. Construct once per container with
 * the configured scope; routes never pass scope information themselves.
 */
export class Portal {
	constructor(
		readonly scope: TenantScope,
		private source: DataSource
	) {}

	ping(): Promise<void> {
		return this.source.ping();
	}

	// ---- scope verification (defense in depth) ------------------------------

	private checkAgent(a: RawFleetAgent): RawFleetAgent {
		if (!a.policy_id || !this.scope.agentPolicyIds.includes(a.policy_id)) {
			throw new ScopeViolationError(`agent ${a.id} has policy outside tenant scope`);
		}
		return a;
	}

	private checkMeta(m: RawEndpointMetadata, allowedAgentIds: Set<string>): RawEndpointMetadata {
		if (!allowedAgentIds.has(m.metadata.agent.id)) {
			throw new ScopeViolationError(
				`endpoint metadata for unexpected agent ${m.metadata.agent.id}`
			);
		}
		return m;
	}

	private checkAlert(h: RawAlertHit): RawAlertHit {
		const spaces = strList(h._source, 'kibana.space_ids');
		const ns = str(h._source, 'data_stream.namespace');
		if (!spaces.includes(this.scope.spaceId) || !ns || !this.scope.namespaces.includes(ns)) {
			throw new ScopeViolationError(`alert ${h._id} outside tenant scope`);
		}
		return h;
	}

	/** Browser-supplied policy filters may only narrow the tenant's own set. */
	private narrowPolicies(requested?: string[]): string[] | undefined {
		if (!requested?.length) return undefined;
		const allowed = requested.filter((p) => this.scope.agentPolicyIds.includes(p));
		// Asking only for foreign policies yields an impossible filter, not "all".
		return allowed.length ? allowed : ['__none__'];
	}

	// ---- agents ----------------------------------------------------------

	private async policyNames(): Promise<Map<string, string>> {
		const policies = await this.source.agentPolicies(this.scope);
		return new Map(
			policies.filter((p) => this.scope.agentPolicyIds.includes(p.id)).map((p) => [p.id, p.name])
		);
	}

	private async context(): Promise<AgentContext> {
		const [policyNames, available] = await Promise.all([
			this.policyNames(),
			// Optional feature ("Upgrade available"): never fail a page over it.
			this.source.availableVersions(this.scope).catch((e: Error) => {
				console.warn(
					JSON.stringify({
						level: 'warn',
						msg: 'available versions unavailable',
						detail: e.message
					})
				);
				return [] as string[];
			})
		]);
		const latestVersion = [...available].sort((a, b) => compareVersions(b, a))[0];
		return { policyNames, latestVersion };
	}

	private async metadataFor(agents: RawFleetAgent[]): Promise<Map<string, RawEndpointMetadata>> {
		const ids = agents.map((a) => a.id);
		const allowed = new Set(ids);
		const metas = await this.source.endpointMetadata(this.scope, ids);
		return new Map(
			metas.map((m) => this.checkMeta(m, allowed)).map((m) => [m.metadata.agent.id, m])
		);
	}

	async agents(q: AgentQuery): Promise<Page<AgentSummary>> {
		const query = { ...q, policyIds: this.narrowPolicies(q.policyIds) };
		const [res, ctx] = await Promise.all([
			this.source.listAgents(this.scope, query),
			this.context()
		]);
		const items = res.items.map((a) => this.checkAgent(a));
		const metas = await this.metadataFor(items);
		return {
			items: items.map((a) => normalizeAgent(a, metas.get(a.id), ctx)),
			total: res.total,
			page: q.page,
			pageSize: q.pageSize
		};
	}

	/** Fleet-style agent list: page of agents, their detection counts, status summary bar. */
	async agentList(q: AgentQuery): Promise<AgentPage> {
		const query = { ...q, policyIds: this.narrowPolicies(q.policyIds) };
		const [page, summary] = await Promise.all([
			this.agents(q),
			this.source.agentStatusSummary(this.scope, query)
		]);
		const counts = await this.source.alertCountsByAgent(
			this.scope,
			page.items.map((a) => a.agentId)
		);
		return {
			...page,
			items: page.items.map((a) => agentRow(a, counts.get(a.agentId))),
			statusSummary: groupCounts(summary)
		};
	}

	async agent(agentId: string): Promise<AgentDetail | null> {
		const raw = await this.source.getAgent(this.scope, agentId);
		if (!raw) return null;
		// A foreign agent fetched by id is "not found" for this tenant, not an error.
		if (!raw.policy_id || !this.scope.agentPolicyIds.includes(raw.policy_id) || !raw.active)
			return null;
		const [metas, ctx, counts] = await Promise.all([
			this.metadataFor([raw]),
			this.context(),
			this.source.alertCountsByAgent(this.scope, [raw.id])
		]);
		return normalizeAgentDetail(raw, metas.get(raw.id), ctx, counts.get(raw.id));
	}

	async agentFacets(): Promise<AgentFacets> {
		const [values, names] = await Promise.all([
			this.source.agentFacetValues(this.scope),
			this.policyNames()
		]);
		return {
			versions: [...values.versions].sort((a, b) => compareVersions(b, a)),
			tags: [...values.tags].sort(),
			policies: [...names]
				.map(([id, name]) => ({ id, name }))
				.sort((a, b) => a.name.localeCompare(b.name))
		};
	}

	async agentStatusCounts(): Promise<FleetStatusCounts> {
		const { results: r } = await this.source.agentStatus(this.scope);
		// agent_status already folds degraded into error and enrolling into updating.
		return groupCounts({
			online: r.online,
			error: r.error,
			orphaned: r.orphaned,
			updating: r.updating,
			offline: r.offline,
			inactive: r.inactive,
			unenrolled: 0,
			uninstalled: r.uninstalled
		});
	}

	/**
	 * Elastic Defend policy status counts across the tenant fleet (like Kibana's
	 * Endpoints list), bounded to `maxAgents`. Also returns agents needing
	 * attention: unhealthy/offline in Fleet, or a policy response that is not
	 * success.
	 */
	async policyOverview(maxAgents = 5000) {
		const counts: Record<PolicyStatus, number> = {
			success: 0,
			warning: 0,
			failure: 0,
			unknown: 0,
			not_installed: 0
		};
		const attention: AgentSummary[] = [];
		const pageSize = 500;
		let seen = 0;
		let truncated = false;
		for (let page = 1; ; page++) {
			const res = await this.agents({ sort: 'hostname', dir: 'asc', page, pageSize });
			for (const a of res.items) {
				if (['inactive', 'unenrolled', 'uninstalled'].includes(a.fleetStatusGroup)) continue;
				counts[a.defend.status]++;
				// Updating agents are routine, not a problem; they only count when
				// their Defend policy reports a problem.
				if (
					['unhealthy', 'orphaned', 'offline'].includes(a.fleetStatusGroup) ||
					a.defend.status === 'failure' ||
					a.defend.status === 'warning'
				) {
					attention.push(a);
				}
			}
			seen += res.items.length;
			if (seen >= res.total || res.items.length === 0) break;
			if (seen >= maxAgents) {
				truncated = true;
				break;
			}
		}
		// Most severe first: policy failure, other unhealthy/orphaned, policy warning, offline.
		const rank = (a: AgentSummary) => {
			if (a.defend.status === 'failure') return 0;
			if (a.defend.status === 'warning') return 2;
			if (a.fleetStatusGroup === 'unhealthy' || a.fleetStatusGroup === 'orphaned') return 1;
			return 3;
		};
		attention.sort((a, b) => rank(a) - rank(b) || a.hostname.localeCompare(b.hostname));
		return {
			counts,
			attention: attention.slice(0, 5),
			attentionTotal: attention.length,
			truncated
		};
	}

	// ---- alerts -------------------------------------------------------------

	async alerts(q: AlertQuery): Promise<Page<AlertSummary>> {
		const res = await this.source.searchAlerts(this.scope, q);
		return {
			items: res.hits.map((h) => normalizeAlertSummary(this.checkAlert(h))),
			total: res.total,
			page: q.page,
			pageSize: q.pageSize,
			totalIsLowerBound: res.totalIsLowerBound || res.total >= LIMITS.maxResultWindow
		};
	}

	async alert(alertId: string): Promise<AlertDetail | null> {
		if (!/^[A-Za-z0-9_-]{1,128}$/.test(alertId)) return null;
		const hit = await this.source.getAlert(this.scope, alertId);
		if (!hit) return null;
		const detail = normalizeAlertDetail(this.checkAlert(hit));
		if (detail.detectionRule.uuid) {
			// Best effort: the alert is still useful if the rule lookup fails.
			detail.detectionRule.name = await this.ruleName(detail.detectionRule.uuid);
		}
		return detail;
	}

	/** Best effort: an alert stays useful without its rule name, but say why it's missing. */
	private ruleName(uuid: string): Promise<string | undefined> {
		return this.source.detectionRuleName(this.scope, uuid).catch((e: Error) => {
			console.warn(
				JSON.stringify({ level: 'warn', msg: 'detection rule lookup failed', detail: e.message })
			);
			return undefined;
		});
	}

	async alertStats(range: TimeRange): Promise<{ stats: AlertStats; recent: AlertSummary[] }> {
		const a = await this.source.alertAggregates(this.scope, range);
		const sev = (r: Partial<Record<Severity, number>>) => ({
			critical: r.critical ?? 0,
			high: r.high ?? 0,
			medium: r.medium ?? 0,
			low: r.low ?? 0
		});
		return {
			stats: {
				total: a.total,
				bySeverity: sev(a.bySeverity),
				activeBySeverity: sev(a.activeBySeverity),
				byStatus: {
					open: a.byStatus.open ?? 0,
					acknowledged: a.byStatus.acknowledged ?? 0,
					closed: a.byStatus.closed ?? 0
				},
				prevented: a.prevented
			},
			recent: a.recentHighPriority.map((h) => normalizeAlertSummary(this.checkAlert(h)))
		};
	}

	async alertFacets(range: TimeRange): Promise<AlertFacets> {
		const ids = await this.source.alertRuleIds(this.scope, range);
		const rules = await Promise.all(
			ids.map(async (id) => ({
				id,
				name: (await this.ruleName(id)) ?? `Unknown rule (${id.slice(0, 8)})`
			}))
		);
		return { rules: rules.sort((a, b) => a.name.localeCompare(b.name)) };
	}

	async overview(range: TimeRange): Promise<Overview> {
		const [agents, policy, alerts] = await Promise.all([
			this.agentStatusCounts(),
			this.policyOverview(),
			this.alertStats(range)
		]);
		return {
			tenantName: this.scope.name,
			agents,
			policy: policy.counts,
			alerts: alerts.stats,
			recentHighPriority: alerts.recent,
			attention: policy.attention,
			attentionTotal: policy.attentionTotal,
			policyCountsCapped: policy.truncated
		};
	}
}
