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
import { INTL_TAG, locale, num, t } from '#lib/i18n/index.svelte.ts';

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

/** Labels in the current language: `label` is read when shown, so it follows a language switch. */
function labels<K extends string>(
	tones: Record<K, Tone>,
	text: () => Record<K, string>
): Record<K, Label> {
	return Object.fromEntries(
		(Object.entries(tones) as [K, Tone][]).map(([k, tone]) => [
			k,
			{
				tone,
				get label() {
					return text()[k];
				}
			}
		])
	) as Record<K, Label>;
}

const severityLabels = labels<Severity>(
	{ critical: 'critical', high: 'high', medium: 'medium', low: 'low' },
	() => t().severity
);
export const severityLabel = (s: Severity): Label => severityLabels[s];

export const workflowLabel = labels<WorkflowStatus>(
	{ open: 'bad', acknowledged: 'warn', closed: 'neutral' },
	() => t().workflow
);

/** Kibana's closing reasons; unknown ones are shown as stored. */
export const closingReasonLabel = (reason: string): string => t().closingReason[reason] ?? reason;

export const outcomeLabel = labels<AlertOutcome>(
	{ prevented: 'ok', detected: 'warn', unknown: 'neutral' },
	() => t().outcome
);

export const kindLabel = (k: AlertKind): string => t().kind[k];

/** Kibana Fleet agent status badges (Fleet → Agents). */
export const fleetGroupLabel = labels<FleetStatusGroup>(
	{
		healthy: 'ok',
		unhealthy: 'warn',
		orphaned: 'warn',
		updating: 'info',
		offline: 'neutral',
		inactive: 'neutral',
		unenrolled: 'neutral',
		uninstalled: 'neutral'
	},
	() => t().fleet
);

/** Badge for a raw Fleet status: Fleet shows the grouped status (degraded -> Unhealthy). */
export const fleetLabel = Object.fromEntries(
	Object.entries(FLEET_STATUS_GROUPS).flatMap(([group, statuses]) =>
		statuses.map((st) => [st, fleetGroupLabel[group as FleetStatusGroup]])
	)
) as Record<FleetStatus, Label>;

/** Fleet shows memory in MB and CPU as a percentage. */
export function formatMemory(bytes: number | undefined): string {
	return bytes === undefined ? t().common.na : `${num(Math.round(bytes / (1024 * 1024)))} MB`;
}
export function formatCpu(percent: number | undefined): string {
	return percent === undefined ? t().common.na : `${fixed2().format(percent)} %`;
}

/** Kibana Security → Endpoints "Policy status" wording. */
export const policyLabel = labels<PolicyStatus>(
	{
		success: 'ok',
		warning: 'warn',
		failure: 'bad',
		unknown: 'neutral',
		not_installed: 'neutral'
	},
	() => t().policy
);

/** One Intl formatter per language, made on first use. */
function perLocale<F>(make: (tag: string) => F): () => F {
	const made = new Map<string, F>();
	return () => {
		const tag = INTL_TAG[locale()];
		let f = made.get(tag);
		if (!f) made.set(tag, (f = make(tag)));
		return f;
	};
}

const fixed2 = perLocale(
	(tag) => new Intl.NumberFormat(tag, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
);
const rtf = perLocale((tag) => new Intl.RelativeTimeFormat(tag, { numeric: 'auto' }));

export function relativeTime(iso: string | undefined, now = Date.now()): string {
	if (!iso) return '—';
	const diff = (Date.parse(iso) - now) / 1000;
	const abs = Math.abs(diff);
	if (abs < 60) return t().common.justNow;
	if (abs < 3600) return rtf().format(Math.round(diff / 60), 'minute');
	if (abs < 86400) return rtf().format(Math.round(diff / 3600), 'hour');
	if (abs < 86400 * 30) return rtf().format(Math.round(diff / 86400), 'day');
	// Older: the date alone, so it fits wherever a relative time does.
	return formatDay(iso);
}

const dtf = perLocale(
	(tag) => new Intl.DateTimeFormat(tag, { dateStyle: 'medium', timeStyle: 'short' })
);
const dtfSec = perLocale(
	(tag) => new Intl.DateTimeFormat(tag, { dateStyle: 'medium', timeStyle: 'medium' })
);
const dtfDay = perLocale((tag) => new Intl.DateTimeFormat(tag, { dateStyle: 'medium' }));

function formatDay(iso: string | undefined): string {
	if (!iso) return '—';
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? '—' : dtfDay().format(d);
}

export function formatDate(iso: string | undefined, seconds = false): string {
	if (!iso) return '—';
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? '—' : (seconds ? dtfSec() : dtf()).format(d);
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
	const label =
		t().component[status.toUpperCase()] ??
		status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
	const rest = message ? stripStatusPrefix(message) : '';
	return rest && rest.toLowerCase() !== status.toLowerCase() ? `${label} · ${rest}` : label;
}

export interface IntegrationRow {
	name: string;
	status: string;
	message?: string;
}

/** Display name of an integration row; product names stay as they are. */
export const integrationName = (name: string): string => t().integration[name] ?? name;

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
