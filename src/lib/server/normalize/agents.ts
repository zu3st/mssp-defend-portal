import type {
	AgentDetail,
	AgentSummary,
	AlertCounts,
	DefendHealth,
	FleetStatus,
	FleetStatusGroup,
	AgentRow,
	PolicyStatus
} from '#lib/contract.ts';
import { FLEET_STATUS_GROUPS, FLEET_STATUSES } from '#lib/contract.ts';
import type { RawEndpointMetadata, RawFleetAgent, RawFleetComponent } from '../elastic/raw';

export function fleetStatus(raw: RawFleetAgent): FleetStatus {
	const s = raw.status as FleetStatus | undefined;
	if (s && FLEET_STATUSES.includes(s)) return s;
	// Fleet always calculates `status`; treat anything unexpected conservatively.
	return raw.active ? 'error' : 'inactive';
}

/** Map a raw Fleet status to the status Kibana Fleet displays. */
export function fleetStatusGroup(status: FleetStatus): FleetStatusGroup {
	for (const [group, statuses] of Object.entries(FLEET_STATUS_GROUPS)) {
		if (statuses.includes(status)) return group as FleetStatusGroup;
	}
	return 'unhealthy';
}

/** Numeric compare of `x.y.z` versions (snapshot suffix ignored). */
export function compareVersions(a: string, b: string): number {
	const pa = a.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
	const pb = b.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
	for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
	return 0;
}

/** The Elastic Defend component in Fleet's component list (type `endpoint`). */
function defendComponent(raw: RawFleetAgent): RawFleetComponent | undefined {
	return raw.components?.find((c) => c.type === 'endpoint' || c.id.startsWith('endpoint-'));
}

const RESPONSE_STATUSES: PolicyStatus[] = ['success', 'warning', 'failure'];

/**
 * Elastic Defend policy status, mirroring Kibana's Endpoints list: taken from
 * the endpoint policy response only, and shown as last reported (also for
 * offline agents). Fleet agent health is reported separately.
 */
export function defendHealth(raw: RawFleetAgent, meta?: RawEndpointMetadata): DefendHealth {
	const component = defendComponent(raw);
	const applied = meta?.metadata.Endpoint?.policy?.applied;
	const reported = applied?.status as PolicyStatus | undefined;

	let status: PolicyStatus;
	if (!component && !meta) status = 'not_installed';
	else if (reported && RESPONSE_STATUSES.includes(reported)) status = reported;
	else status = 'unknown';

	return {
		status,
		policyName: applied?.name,
		componentStatus: component?.status,
		componentMessage: component?.message || undefined,
		endpointVersion: meta?.metadata.agent.version,
		isolated: meta?.metadata.Endpoint?.state?.isolation,
		reportedAt: toIso(meta?.metadata['@timestamp'])
	};
}

function toIso(v: number | string | undefined): string | undefined {
	if (v === undefined) return undefined;
	const d = new Date(v);
	return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function fleetMessage(raw: RawFleetAgent, status: FleetStatus): string | undefined {
	if (fleetStatusGroup(status) !== 'unhealthy') return undefined;
	if (raw.last_checkin_message && raw.last_checkin_message !== 'Running')
		return raw.last_checkin_message;
	if (raw.unhealthy_reason?.length) return `Unhealthy: ${raw.unhealthy_reason.join(', ')}`;
	return undefined;
}

export interface AgentContext {
	policyNames: Map<string, string>;
	/** Newest Elastic Agent version Fleet offers; drives "Upgrade available". */
	latestVersion?: string;
}

export function normalizeAgent(
	raw: RawFleetAgent,
	meta: RawEndpointMetadata | undefined,
	ctx: AgentContext
): AgentSummary {
	const host = raw.local_metadata?.host;
	const os = raw.local_metadata?.os;
	const status = fleetStatus(raw);
	const version = raw.local_metadata?.elastic?.agent?.version ?? raw.agent?.version;
	const cpu = raw.metrics?.cpu_avg;
	return {
		agentId: raw.id,
		hostId: host?.id,
		hostname: host?.hostname ?? host?.name ?? raw.id,
		os: os
			? { name: os.name, version: os.version, family: os.family, platform: os.platform }
			: undefined,
		ips: host?.ip ?? [],
		agentVersion: version,
		fleetStatus: status,
		fleetStatusGroup: fleetStatusGroup(status),
		fleetMessage: fleetMessage(raw, status),
		policyId: raw.policy_id,
		policyName: raw.policy_id ? ctx.policyNames.get(raw.policy_id) : undefined,
		policyRevision: raw.policy_revision,
		lastCheckin: raw.last_checkin,
		enrolledAt: raw.enrolled_at,
		// Fleet reports metrics only for agents that are currently sending them.
		cpuPercent: typeof cpu === 'number' ? Math.round(cpu * 10_000) / 100 : undefined,
		memoryBytes: raw.metrics?.memory_size_byte_avg,
		upgradeAvailable:
			version && ctx.latestVersion && raw.local_metadata?.elastic?.agent?.upgradeable !== false
				? compareVersions(version, ctx.latestVersion) < 0
				: undefined,
		defend: defendHealth(raw, meta),
		tags: raw.tags ?? []
	};
}

const EMPTY_COUNTS: AlertCounts = { open: 0, acknowledged: 0, closed: 0, total: 0 };

export function agentRow(summary: AgentSummary, counts: AlertCounts | undefined): AgentRow {
	return { ...summary, alerts: counts ?? EMPTY_COUNTS };
}

export function normalizeAgentDetail(
	raw: RawFleetAgent,
	meta: RawEndpointMetadata | undefined,
	ctx: AgentContext,
	counts: AlertCounts | undefined
): AgentDetail {
	return {
		...agentRow(normalizeAgent(raw, meta, ctx), counts),
		architecture: raw.local_metadata?.host?.architecture,
		kernel: raw.local_metadata?.os?.kernel,
		osFull: raw.local_metadata?.os?.full,
		macs: raw.local_metadata?.host?.mac ?? [],
		logLevel: raw.local_metadata?.elastic?.agent?.log_level,
		lastCheckinMessage: raw.last_checkin_message,
		components: (raw.components ?? []).map((c) => ({
			id: c.id,
			type: c.type,
			status: c.status,
			message: c.message || undefined
		}))
	};
}
