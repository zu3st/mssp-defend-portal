/**
 * Normalized data contract between the portal backend and the browser.
 *
 * Everything the browser receives is one of these shapes. They are built by
 * the normalizers in `#lib/server/normalize` from raw Elastic responses and
 * carry only allowlisted fields. Optional fields are left out when Elastic does
 * not provide them.
 */

// ---------------------------------------------------------------------------
// Shared

export type Severity = 'low' | 'medium' | 'high' | 'critical';
export const SEVERITIES: readonly Severity[] = ['critical', 'high', 'medium', 'low'];

/** Elastic Security alert workflow status (`kibana.alert.workflow_status`). */
export type WorkflowStatus = 'open' | 'acknowledged' | 'closed';
export const WORKFLOW_STATUSES: readonly WorkflowStatus[] = ['open', 'acknowledged', 'closed'];

export interface Page<T> {
	items: T[];
	total: number;
	page: number; // 1-based
	pageSize: number;
	/** True when `total` is a lower bound (Elastic stops counting / paging limits). */
	totalIsLowerBound?: boolean;
}

export type SortDirection = 'asc' | 'desc';

// ---------------------------------------------------------------------------
// Agents / endpoints

/** Status as calculated by Fleet (`status` on the Fleet agent API). */
export type FleetStatus =
	| 'online'
	| 'error'
	| 'degraded'
	| 'offline'
	| 'updating'
	| 'enrolling'
	| 'unenrolling'
	| 'inactive'
	| 'unenrolled'
	| 'orphaned'
	| 'uninstalled';

export const FLEET_STATUSES: readonly FleetStatus[] = [
	'online',
	'error',
	'degraded',
	'offline',
	'updating',
	'enrolling',
	'unenrolling',
	'inactive',
	'unenrolled',
	'orphaned',
	'uninstalled'
];

/**
 * The statuses Kibana Fleet shows in its agent list (badges, status filter and
 * summary bar). Several raw statuses map to one: e.g. `error` and `degraded`
 * are both "Unhealthy".
 */
export type FleetStatusGroup =
	| 'healthy'
	| 'unhealthy'
	| 'orphaned'
	| 'updating'
	| 'offline'
	| 'inactive'
	| 'unenrolled'
	| 'uninstalled';

export const FLEET_STATUS_GROUPS: Record<FleetStatusGroup, readonly FleetStatus[]> = {
	healthy: ['online'],
	unhealthy: ['error', 'degraded'],
	orphaned: ['orphaned'],
	updating: ['updating', 'enrolling', 'unenrolling'],
	offline: ['offline'],
	inactive: ['inactive'],
	unenrolled: ['unenrolled'],
	uninstalled: ['uninstalled']
};

/**
 * Elastic Defend policy status, as Kibana shows it in Security → Endpoints
 * ("Policy status"): the endpoint's policy response
 * (`Endpoint.policy.applied.status`). Kibana keeps showing the last reported
 * value when the agent is offline; so do we. The Fleet agent status is a
 * separate field, exactly as in Kibana's "Agent status" column.
 */
export type PolicyStatus =
	| 'success'
	| 'warning'
	| 'failure'
	| 'unknown' // Defend installed but no (valid) policy response yet
	| 'not_installed'; // agent has no Elastic Defend integration

export interface DefendHealth {
	status: PolicyStatus;
	policyName?: string;
	/** Elastic Defend component state as reported to Fleet (detail view only). */
	componentStatus?: string;
	componentMessage?: string;
	endpointVersion?: string;
	isolated?: boolean;
	/** Timestamp of the endpoint metadata document the policy response came from. */
	reportedAt?: string;
}

export interface AgentSummary {
	agentId: string;
	hostId?: string;
	hostname: string;
	os?: { name?: string; version?: string; family?: string; platform?: string };
	ips: string[];
	agentVersion?: string;
	fleetStatus: FleetStatus;
	fleetStatusGroup: FleetStatusGroup;
	/** Short human-readable reason when Fleet reports an unhealthy agent. */
	fleetMessage?: string;
	policyId?: string;
	policyName?: string;
	policyRevision?: number;
	/** Fleet "Last activity". */
	lastCheckin?: string;
	enrolledAt?: string;
	/** Fleet agent metrics (`withMetrics=true`): CPU percent and memory bytes. */
	cpuPercent?: number;
	memoryBytes?: number;
	/** A newer Elastic Agent version is available (Fleet "Upgrade available"). */
	upgradeAvailable?: boolean;
	defend: DefendHealth;
	tags: string[];
}

export interface AlertCounts {
	open: number;
	acknowledged: number;
	closed: number;
	total: number;
}

/** Agent list row: the Fleet agent plus this customer's detection counts. */
export interface AgentRow extends AgentSummary {
	alerts: AlertCounts;
}

export interface AgentComponent {
	id: string;
	type: string;
	status: string;
	message?: string;
}

export interface AgentDetail extends AgentRow {
	architecture?: string;
	kernel?: string;
	osFull?: string;
	macs: string[];
	logLevel?: string;
	lastCheckinMessage?: string;
	components: AgentComponent[];
}

export interface AgentFacets {
	versions: string[];
	tags: string[];
	policies: { id: string; name: string }[];
}

export type AgentSortField = 'hostname' | 'policy' | 'lastCheckin' | 'agentVersion' | 'enrolledAt';

export interface AgentQuery {
	search?: string;
	/** Raw Fleet statuses (expanded from the selected status groups). */
	statuses?: FleetStatus[];
	/** Status groups as selected in the UI; echo only. */
	statusGroups?: FleetStatusGroup[];
	versions?: string[];
	tags?: string[];
	policyIds?: string[];
	upgradeAvailable?: boolean;
	sort: AgentSortField;
	dir: SortDirection;
	page: number;
	pageSize: number;
}

export type FleetStatusCounts = Record<FleetStatusGroup, number> & { total: number };

export interface AgentPage extends Page<AgentRow> {
	/** Fleet's status summary bar for the current filters (status filter excluded). */
	statusSummary: FleetStatusCounts;
}

// ---------------------------------------------------------------------------
// Detections

/** Detection family, derived from the Elastic Defend `event.code`. */
export type AlertKind = 'malware' | 'memory' | 'ransomware' | 'behavior' | 'rule';
export const ALERT_KINDS: readonly AlertKind[] = [
	'malware',
	'memory',
	'ransomware',
	'behavior',
	'rule'
];

/**
 * What Elastic Defend did. `unknown` when the alert does not reliably say
 * (e.g. non-endpoint rules).
 */
export type AlertOutcome = 'prevented' | 'detected' | 'unknown';

export interface AlertSummary {
	id: string;
	timestamp: string;
	/** Most specific detection name: the Defend rule for behavior/memory alerts, else the rule name. */
	title: string;
	/** Kibana detection rule name (`kibana.alert.rule.name`); filterable. */
	ruleName: string;
	kind: AlertKind;
	severity: Severity;
	riskScore?: number;
	status: WorkflowStatus;
	closingReason?: string;
	outcome: AlertOutcome;
	hostname?: string;
	agentId?: string;
	userName?: string;
	/** One-line context (file name, process name …) for the table. */
	subject?: string;
}

/** One row of Kibana's "Highlighted fields" table (ECS field name, values). */
export interface HighlightedField {
	field: string;
	values: string[];
}

/**
 * Alert flyout data. Detection-type-specific fields are carried in
 * `highlighted`, built server-side from the field allowlist.
 */
export interface AlertDetail extends AlertSummary {
	/**
	 * The Kibana detection rule that created the alert, found via
	 * `kibana.alert.rule.uuid` (legacy `signal.rule.id`). Its name is looked up
	 * because rule-name overrides replace it in the alert document.
	 */
	detectionRule: { uuid?: string; name?: string; description?: string };
	/** Elastic Defend's own rule (`rule.name` / `rule.description`) for behavior and memory alerts. */
	defendRule?: { name: string; description?: string };
	/** Number of assigned analysts (`kibana.alert.workflow_assignee_ids`); names are not exposed. */
	assignees: number;
	/** Detection-type-specific field list, as in Kibana's flyout; allowlisted fields only. */
	highlighted: HighlightedField[];
	reason?: string;
	mitre: { tactic?: string; techniqueId?: string; technique?: string }[];
}

export type AlertSortField = 'timestamp' | 'severity' | 'ruleName' | 'hostname' | 'status';

export interface TimeRange {
	from: string; // ISO
	to: string; // ISO
}

export interface AlertQuery {
	search?: string;
	severities?: Severity[];
	statuses?: WorkflowStatus[];
	kinds?: AlertKind[];
	/** Source detection rules (`kibana.alert.rule.uuid`), not overridden names. */
	ruleIds?: string[];
	/** Restrict to one endpoint (reliable identifier, not hostname). */
	agentId?: string;
	hostname?: string;
	range: TimeRange;
	sort: AlertSortField;
	dir: SortDirection;
	page: number;
	pageSize: number;
}

export interface AlertStats {
	bySeverity: Record<Severity, number>;
	/** Severity counts restricted to open + acknowledged alerts. */
	activeBySeverity: Record<Severity, number>;
	byStatus: Record<WorkflowStatus, number>;
	prevented: number;
	total: number;
}

export interface AlertFacets {
	/** Detection rules that produced alerts in the range, names looked up by uuid. */
	rules: { id: string; name: string }[];
}

// ---------------------------------------------------------------------------
// Overview

export interface Overview {
	tenantName: string;
	agents: FleetStatusCounts;
	policy: Record<PolicyStatus, number>;
	alerts: AlertStats;
	/** Policy counts cover only the first N agents (very large fleets). */
	policyCountsCapped: boolean;
	recentHighPriority: AlertSummary[];
	/** Top agents needing attention (at most 5), most severe first. */
	attention: AgentSummary[];
	attentionTotal: number;
}
