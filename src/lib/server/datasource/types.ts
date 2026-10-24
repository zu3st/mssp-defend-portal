import type {
	AgentQuery,
	AlertCounts,
	AlertQuery,
	Severity,
	TimeRange,
	WorkflowStatus
} from '#lib/contract.ts';
import type { TenantScope } from '../config';
import type {
	RawAgentPolicy,
	RawAlertHit,
	RawEndpointMetadata,
	RawFleetAgent,
	RawFleetAgentList,
	RawFleetAgentStatus
} from '../elastic/raw';

/**
 * Read-only access to one Elastic deployment. Every method takes the tenant
 * scope and MUST apply it itself (policies, space, namespaces); the service
 * layer additionally verifies every returned record (defense in depth).
 *
 * Methods return raw Elastic shapes so that mock and real implementations
 * share one set of normalizers.
 */
export interface DataSource {
	readonly kind: 'mock' | 'elastic';

	listAgents(scope: TenantScope, q: AgentQuery): Promise<RawFleetAgentList>;
	getAgent(scope: TenantScope, agentId: string): Promise<RawFleetAgent | null>;
	agentStatus(scope: TenantScope): Promise<RawFleetAgentStatus>;
	agentPolicies(scope: TenantScope): Promise<RawAgentPolicy[]>;
	/** Distinct agent versions and tags of the tenant's agents (filter options). */
	agentFacetValues(scope: TenantScope): Promise<{ versions: string[]; tags: string[] }>;
	/** Raw Fleet status -> count for a query, ignoring its status filter (summary bar). */
	agentStatusSummary(scope: TenantScope, q: AgentQuery): Promise<Partial<Record<string, number>>>;
	/** Elastic Agent versions Fleet can upgrade to, newest first. */
	availableVersions(scope: TenantScope): Promise<string[]>;
	endpointMetadata(scope: TenantScope, agentIds: string[]): Promise<RawEndpointMetadata[]>;

	searchAlerts(scope: TenantScope, q: AlertQuery): Promise<AlertSearchResult>;
	getAlert(scope: TenantScope, alertId: string): Promise<RawAlertHit | null>;
	/** Name of the detection rule (in the tenant's space) that created an alert. */
	detectionRuleName(scope: TenantScope, ruleUuid: string): Promise<string | undefined>;
	alertAggregates(scope: TenantScope, range: TimeRange): Promise<AlertAggregates>;
	alertCountsByAgent(scope: TenantScope, agentIds: string[]): Promise<Map<string, AlertCounts>>;
	/** Distinct source rule uuids (`kibana.alert.rule.uuid`) of alerts in the range. */
	alertRuleIds(scope: TenantScope, range: TimeRange): Promise<string[]>;

	/** Cheap connectivity check for readiness probes. */
	ping(): Promise<void>;
}

export interface AlertSearchResult {
	hits: RawAlertHit[];
	total: number;
	totalIsLowerBound: boolean;
}

export interface AlertAggregates {
	total: number;
	bySeverity: Partial<Record<Severity, number>>;
	activeBySeverity: Partial<Record<Severity, number>>;
	byStatus: Partial<Record<WorkflowStatus, number>>;
	prevented: number;
	/** Recent open/acknowledged high+critical alerts, newest first. */
	recentHighPriority: RawAlertHit[];
}

/** Hard limits that bound every query regardless of request input. */
export const LIMITS = {
	maxPageSize: 100,
	/** Elasticsearch `index.max_result_window` default. */
	maxResultWindow: 10_000,
	maxAgentIdsPerQuery: 1_000,
	maxSearchLength: 64
} as const;
