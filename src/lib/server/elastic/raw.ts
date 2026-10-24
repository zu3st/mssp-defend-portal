/**
 * Subsets of the raw Elastic response shapes the portal consumes.
 *
 * - Fleet agents:      GET  {kibana}/s/{space}/api/fleet/agents
 * - Fleet status:      GET  {kibana}/s/{space}/api/fleet/agent_status
 * - Agent policies:    GET  {kibana}/s/{space}/api/fleet/agent_policies
 * - Endpoint metadata: GET  {kibana}/s/{space}/api/endpoint/metadata
 * - Alerts:            POST {es}/.alerts-security.alerts-{space}/_search
 *
 * Only fields we read are typed; everything else is ignored. Mock fixtures use
 * exactly these shapes so the same normalizers run against mock and real data.
 */

interface RawFleetComponentUnit {
	id: string;
	type: 'input' | 'output';
	status: string;
	message?: string;
}

export interface RawFleetComponent {
	id: string;
	type: string;
	status: string; // HEALTHY | DEGRADED | FAILED | STARTING | CONFIGURING | STOPPING | STOPPED
	message?: string;
	units?: RawFleetComponentUnit[];
}

export interface RawFleetAgent {
	id: string;
	type?: string;
	active: boolean;
	status?: string;
	policy_id?: string;
	policy_revision?: number;
	enrolled_at?: string;
	last_checkin?: string;
	last_checkin_status?: string;
	last_checkin_message?: string;
	unhealthy_reason?: string[];
	tags?: string[];
	namespaces?: string[];
	upgrade_details?: { state?: string; target_version?: string } | null;
	components?: RawFleetComponent[];
	/** Present with `withMetrics=true`; `cpu_avg` is a fraction (0.0123 = 1.23 %). */
	metrics?: { cpu_avg?: number; memory_size_byte_avg?: number };
	agent?: { id?: string; version?: string };
	local_metadata?: {
		host?: {
			hostname?: string;
			name?: string;
			id?: string;
			ip?: string[];
			mac?: string[];
			architecture?: string;
		};
		os?: {
			name?: string;
			family?: string;
			version?: string;
			platform?: string;
			kernel?: string;
			full?: string;
		};
		elastic?: {
			agent?: {
				id?: string;
				version?: string;
				upgradeable?: boolean;
				snapshot?: boolean;
				log_level?: string;
			};
		};
	};
}

export interface RawFleetAgentList {
	items: RawFleetAgent[];
	total: number;
	page: number;
	perPage: number;
	/** Present with `getStatusSummary=true`: raw status -> count for the query. */
	statusSummary?: Partial<Record<string, number>>;
}

export interface RawFleetAgentStatus {
	results: {
		online: number;
		error: number;
		offline: number;
		updating: number;
		inactive: number;
		unenrolled: number;
		orphaned?: number;
		uninstalled?: number;
		degraded?: number;
		enrolling?: number;
		unenrolling?: number;
		all: number;
		active: number;
		other: number;
		events: number;
	};
}

export interface RawAgentPolicy {
	id: string;
	name: string;
	namespace: string;
	revision?: number;
	is_managed?: boolean;
}

export interface RawEndpointMetadata {
	metadata: {
		'@timestamp'?: number | string;
		agent: { id: string; version?: string };
		host?: {
			hostname?: string;
			id?: string;
			ip?: string[];
			os?: { name?: string; version?: string };
		};
		Endpoint?: {
			status?: string;
			policy?: {
				applied?: { id?: string; name?: string; status?: string; endpoint_policy_version?: number };
			};
			state?: { isolation?: boolean };
			configuration?: { isolation?: boolean };
		};
		elastic?: { agent?: { id?: string } };
	};
	host_status?: string;
	last_checkin?: string;
}

export interface RawEndpointMetadataList {
	data: RawEndpointMetadata[];
	total: number;
	page: number;
	pageSize: number;
}

/**
 * An alerts-as-data document `_source`. Kibana writes `kibana.*` fields with
 * dotted keys, while ECS fields copied from the source event are usually
 * nested objects; both forms occur, so access goes through `field()`.
 */
export type RawAlertSource = Record<string, unknown>;

export interface RawAlertHit {
	_id: string;
	_index: string;
	_source: RawAlertSource;
}

export interface RawSearchResponse<A = Record<string, unknown>> {
	hits: { total: { value: number; relation: 'eq' | 'gte' }; hits: RawAlertHit[] };
	aggregations?: A;
}

/**
 * Read a dotted ECS path from a `_source` that may mix nested objects and
 * flattened dotted keys, e.g. `{ "kibana.alert.severity": "high" }` and
 * `{ "process": { "parent": { "name": "x" } } }` and `{ "process.parent": { "name": "x" } }`.
 */
export function field(source: unknown, path: string): unknown {
	if (source === null || typeof source !== 'object') return undefined;
	const obj = source as Record<string, unknown>;
	if (path in obj) return obj[path];
	const parts = path.split('.');
	// Try the longest dotted prefix first, then descend.
	for (let i = parts.length - 1; i > 0; i--) {
		const head = parts.slice(0, i).join('.');
		if (head in obj) {
			const v = field(obj[head], parts.slice(i).join('.'));
			if (v !== undefined) return v;
		}
	}
	return undefined;
}

export function str(source: unknown, path: string): string | undefined {
	const v = field(source, path);
	if (Array.isArray(v)) return typeof v[0] === 'string' && v[0] !== '' ? v[0] : undefined;
	return typeof v === 'string' && v !== '' ? v : undefined;
}

export function num(source: unknown, path: string): number | undefined {
	const v = field(source, path);
	const n = Array.isArray(v) ? v[0] : v;
	if (typeof n === 'number' && Number.isFinite(n)) return n;
	if (typeof n === 'string' && n.trim() !== '' && Number.isFinite(Number(n))) return Number(n);
	return undefined;
}

export function bool(source: unknown, path: string): boolean | undefined {
	const v = field(source, path);
	return typeof v === 'boolean' ? v : undefined;
}

export function strList(source: unknown, path: string): string[] {
	const v = field(source, path);
	if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string' && x !== '');
	return typeof v === 'string' && v !== '' ? [v] : [];
}
