import type {
	AlertKind,
	AlertOutcome,
	FleetStatus,
	FleetStatusGroup,
	PolicyStatus,
	Severity,
	WorkflowStatus
} from '#lib/contract.ts';
import { FLEET_STATUS_GROUPS } from '#lib/contract.ts';

export type Tone =
	'ok' | 'warn' | 'bad' | 'info' | 'neutral' | 'critical' | 'high' | 'medium' | 'low';
/** The one mapping from status tone to theme colour (dots, icons, bars). */
export const toneColor: Record<Tone, string> = {
	ok: 'var(--ok)',
	warn: 'var(--warn)',
	bad: 'var(--bad)',
	info: 'var(--info)',
	neutral: 'var(--muted)',
	critical: 'var(--sev-critical)',
	high: 'var(--sev-high)',
	medium: 'var(--sev-medium)',
	low: 'var(--sev-low)'
};

export interface Label {
	label: string;
	tone: Tone;
}

export const severityLabel = (s: Severity): Label => ({
	label: s[0].toUpperCase() + s.slice(1),
	tone: s
});

export const workflowLabel: Record<WorkflowStatus, Label> = {
	open: { label: 'Open', tone: 'bad' },
	acknowledged: { label: 'Acknowledged', tone: 'warn' },
	closed: { label: 'Closed', tone: 'neutral' }
};

export const closingReasonLabel: Record<string, string> = {
	false_positive: 'False positive',
	true_positive: 'True positive',
	benign_positive: 'Benign positive',
	duplicate: 'Duplicate',
	other: 'Other'
};

export const outcomeLabel: Record<AlertOutcome, Label> = {
	prevented: { label: 'Prevented', tone: 'ok' },
	detected: { label: 'Detected only', tone: 'warn' },
	unknown: { label: 'Not reported', tone: 'neutral' }
};

export const kindLabel: Record<AlertKind, string> = {
	malware: 'Malicious file',
	memory: 'Memory threat',
	ransomware: 'Ransomware',
	behavior: 'Malicious behavior',
	rule: 'Detection rule'
};

/** Kibana Fleet agent status badges (Fleet → Agents). */
export const fleetGroupLabel: Record<FleetStatusGroup, Label> = {
	healthy: { label: 'Healthy', tone: 'ok' },
	unhealthy: { label: 'Unhealthy', tone: 'warn' },
	orphaned: { label: 'Orphaned', tone: 'warn' },
	updating: { label: 'Updating', tone: 'info' },
	offline: { label: 'Offline', tone: 'neutral' },
	inactive: { label: 'Inactive', tone: 'neutral' },
	unenrolled: { label: 'Unenrolled', tone: 'neutral' },
	uninstalled: { label: 'Uninstalled', tone: 'neutral' }
};

/** Badge for a raw Fleet status: Fleet shows the grouped status (degraded -> Unhealthy). */
export const fleetLabel = Object.fromEntries(
	Object.entries(FLEET_STATUS_GROUPS).flatMap(([group, statuses]) =>
		statuses.map((st) => [st, fleetGroupLabel[group as FleetStatusGroup]])
	)
) as Record<FleetStatus, Label>;

/** Fleet shows memory in MB and CPU as a percentage. */
export function formatMemory(bytes: number | undefined): string {
	return bytes === undefined ? 'N/A' : `${Math.round(bytes / (1024 * 1024))} MB`;
}
export function formatCpu(percent: number | undefined): string {
	return percent === undefined ? 'N/A' : `${percent.toFixed(2)} %`;
}

/** Kibana Security → Endpoints "Policy status" wording. */
export const policyLabel: Record<PolicyStatus, Label> = {
	success: { label: 'Success', tone: 'ok' },
	warning: { label: 'Warning', tone: 'warn' },
	failure: { label: 'Failure', tone: 'bad' },
	unknown: { label: 'Unknown', tone: 'neutral' },
	not_installed: { label: 'Not installed', tone: 'neutral' }
};

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

export function relativeTime(iso: string | undefined, now = Date.now()): string {
	if (!iso) return '—';
	const diff = (Date.parse(iso) - now) / 1000;
	const abs = Math.abs(diff);
	if (abs < 60) return 'just now';
	if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
	if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
	if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
	// Older: the date alone, so it fits wherever a relative time does.
	return formatDay(iso);
}

const dtf = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
const dtfSec = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'medium' });
const dtfDay = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' });

function formatDay(iso: string | undefined): string {
	if (!iso) return '—';
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? '—' : dtfDay.format(d);
}

export function formatDate(iso: string | undefined, seconds = false): string {
	if (!iso) return '—';
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? '—' : (seconds ? dtfSec : dtf).format(d);
}

/** Component states from worst to best, as Elastic Agent reports them. */
const COMPONENT_RANK = [
	'FAILED',
	'DEGRADED',
	'STOPPING',
	'STOPPED',
	'STARTING',
	'CONFIGURING',
	'HEALTHY'
];

/**
 * Elastic Agent messages repeat the state they describe ("Degraded: kernel
 * driver…", "Healthy: communicating…"); drop that leading word.
 */
export function stripStatusPrefix(message: string): string {
	return message
		.replace(/^(healthy|degraded|failed|failure|starting|configuring|stopping|stopped)\b:?\s*/i, '')
		.trim();
}

/** "Degraded · kernel driver failed to load", or just "Healthy". */
export function componentLine(status: string, message?: string): string {
	const label = status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
	const rest = message ? stripStatusPrefix(message) : '';
	return rest && rest.toLowerCase() !== status.toLowerCase() ? `${label} · ${rest}` : label;
}

export interface IntegrationRow {
	name: string;
	status: string;
	message?: string;
}

/**
 * Groups an agent's components into rows a customer recognises. Components do
 * not name their integration package, so groups describe what they do; each
 * row takes the worst status (and that component's message) of its parts.
 */
export function groupIntegrations(
	components: { id: string; type: string; status: string; message?: string }[]
): IntegrationRow[] {
	const nameOf = (c: { id: string; type: string }) =>
		c.type === 'endpoint'
			? 'Elastic Defend'
			: c.type === 'fleet-server'
				? 'Fleet Server'
				: c.id.endsWith('-monitoring')
					? 'Elastic Agent monitoring'
					: c.type.endsWith('/metrics')
						? 'System metrics'
						: ['log', 'logfile', 'filestream', 'winlog'].includes(c.type)
							? 'Logs'
							: c.type;
	const rank = (s: string) => {
		const i = COMPONENT_RANK.indexOf(s.toUpperCase());
		return i === -1 ? COMPONENT_RANK.length : i;
	};
	const rows = new Map<string, IntegrationRow>();
	for (const c of components) {
		const name = nameOf(c);
		const row = rows.get(name);
		if (!row || rank(c.status) < rank(row.status))
			rows.set(name, { name, status: c.status, message: c.message });
	}
	const order = [
		'Elastic Defend',
		'System metrics',
		'Logs',
		'Fleet Server',
		'Elastic Agent monitoring'
	];
	return [...rows.values()].sort((a, b) => {
		const ia = order.indexOf(a.name),
			ib = order.indexOf(b.name);
		return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.name.localeCompare(b.name);
	});
}

export function osLabel(os: { name?: string; version?: string } | undefined): string {
	if (!os?.name) return '—';
	return [os.name, os.version].filter(Boolean).join(' ');
}

/** Copy of the current URL with params changed; `undefined` deletes. Resets page unless set. */
export function withParams(
	url: { href: string },
	changes: Record<string, string | string[] | undefined>
): string {
	const u = new URL(url.href);
	if (!('page' in changes)) u.searchParams.delete('page');
	u.searchParams.delete('alert');
	for (const [k, v] of Object.entries(changes)) {
		u.searchParams.delete(k);
		if (Array.isArray(v)) v.forEach((x) => u.searchParams.append(k, x));
		else if (v !== undefined) u.searchParams.set(k, v);
	}
	return u.pathname + u.search;
}
