/**
 * Strict parsing of browser query parameters into bounded query objects.
 * Unknown values are dropped, sizes clamped, dates validated. Tenant scope is
 * applied separately by `Portal`.
 */
import type {
	AgentQuery,
	AgentSortField,
	AlertKind,
	AlertQuery,
	AlertSortField,
	FleetStatusGroup,
	Severity,
	SortDirection,
	TimeRange,
	WorkflowStatus
} from '#lib/contract.ts';
import { ALERT_KINDS, FLEET_STATUS_GROUPS, SEVERITIES, WORKFLOW_STATUSES } from '#lib/contract.ts';
import { LIMITS } from './datasource/types';
import {
	DEFAULT_RANGE,
	parseRelative,
	specFromCookie,
	specFromParams,
	type RangeSpec
} from '#lib/range.ts';

const PAGE_SIZES = [10, 25, 50, 100];
const DAY = 86_400_000;

function many<T extends string>(
	p: URLSearchParams,
	key: string,
	allowed: readonly T[]
): T[] | undefined {
	const values = p
		.getAll(key)
		.flatMap((v) => v.split(','))
		.filter((v): v is T => (allowed as readonly string[]).includes(v));
	return values.length ? [...new Set(values)] : undefined;
}

/** Free-form values (versions, policy ids, rule names): bounded count and length. */
function freeMany(p: URLSearchParams, key: string, re: RegExp, max = 20): string[] | undefined {
	const values = p
		.getAll(key)
		.filter((v) => v.length <= 200 && re.test(v))
		.slice(0, max);
	return values.length ? [...new Set(values)] : undefined;
}

function one<T extends string>(
	p: URLSearchParams,
	key: string,
	allowed: readonly T[],
	fallback: T
): T {
	const v = p.get(key);
	return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

function pageParams(p: URLSearchParams) {
	const page = Math.max(1, Math.floor(Number(p.get('page')) || 1));
	const sizeRaw = Number(p.get('size'));
	const pageSize = PAGE_SIZES.includes(sizeRaw) ? sizeRaw : 25;
	// Never page past Elastic's result window.
	const maxPage = Math.max(1, Math.floor(LIMITS.maxResultWindow / pageSize));
	return { page: Math.min(page, maxPage), pageSize: Math.min(pageSize, LIMITS.maxPageSize) };
}

/** Hostname / id search: restricted charset keeps it a literal everywhere. */
function cleanSearch(v: string | null): string | undefined {
	if (!v) return undefined;
	const s = v
		.trim()
		.replace(/[^\p{L}\p{N}._:@\\/ -]/gu, '')
		.slice(0, LIMITS.maxSearchLength);
	return s || undefined;
}

/** Fleet's agent list preselects these statuses ("Status 5"). */
const DEFAULT_STATUS_GROUPS: FleetStatusGroup[] = [
	'healthy',
	'unhealthy',
	'orphaned',
	'updating',
	'offline'
];
const STATUS_GROUPS = Object.keys(FLEET_STATUS_GROUPS) as FleetStatusGroup[];

export function parseAgentQuery(p: URLSearchParams): AgentQuery {
	const statusGroups = many<FleetStatusGroup>(p, 'status', STATUS_GROUPS) ?? DEFAULT_STATUS_GROUPS;
	return {
		search: cleanSearch(p.get('q'))?.replace(/[^\p{L}\p{N}._-]/gu, '') || undefined,
		statusGroups,
		statuses: statusGroups.flatMap((g) => FLEET_STATUS_GROUPS[g]),
		versions: freeMany(p, 'version', /^\d+\.\d+\.\d+(-SNAPSHOT)?$/),
		tags: freeMany(p, 'tag', /^[^\u0000-\u001f"\\]{1,100}$/),
		policyIds: freeMany(p, 'policy', /^[A-Za-z0-9_-]{1,100}$/),
		upgradeAvailable: p.get('upgrade') === '1' || undefined,
		sort: one<AgentSortField>(
			p,
			'sort',
			['hostname', 'policy', 'lastCheckin', 'agentVersion', 'enrolledAt'],
			'hostname'
		),
		dir: one<SortDirection>(p, 'dir', ['asc', 'desc'], 'asc'),
		...pageParams(p)
	};
}

/** A browser-supplied IANA zone name, or UTC. Used only for calendar boundaries. */
function cleanTimeZone(tz: string | undefined): string {
	if (!tz || !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(tz)) return 'UTC';
	try {
		new Intl.DateTimeFormat('en', { timeZone: tz });
		return tz;
	} catch {
		return 'UTC';
	}
}

/** Calendar date (and weekday, 0 = Sunday) of an instant in `tz`. */
function zonedDate(at: number, tz: string) {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: tz,
		year: 'numeric',
		month: 'numeric',
		day: 'numeric'
	}).formatToParts(at);
	const get = (t: string) => Number(parts.find((x) => x.type === t)?.value);
	const y = get('year'),
		m = get('month'),
		d = get('day');
	return { y, m, d, weekday: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

/** Offset of `tz` from UTC at an instant, in ms (local minus UTC). */
function zoneOffset(at: number, tz: string): number {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: tz,
		hourCycle: 'h23',
		year: 'numeric',
		month: 'numeric',
		day: 'numeric',
		hour: 'numeric',
		minute: 'numeric',
		second: 'numeric'
	}).formatToParts(at);
	const get = (t: string) => Number(parts.find((x) => x.type === t)?.value);
	const local = Date.UTC(
		get('year'),
		get('month') - 1,
		get('day'),
		get('hour'),
		get('minute'),
		get('second')
	);
	return local - Math.floor(at / 1000) * 1000;
}

/** The instant local midnight starts on a calendar date in `tz` (day may overflow). */
function midnight(y: number, m: number, d: number, tz: string): number {
	const wall = Date.UTC(y, m - 1, d);
	const guess = wall - zoneOffset(wall, tz);
	return wall - zoneOffset(guess, tz);
}

function boundsOf(spec: RangeSpec, now: number, tz: string): TimeRange {
	const iso = (t: number) => new Date(t).toISOString();
	if (spec.key === 'custom' && spec.from && spec.to) {
		const [fy, fm, fd] = spec.from.split('-').map(Number);
		const [ty, tm, td] = spec.to.split('-').map(Number);
		const to = midnight(ty, tm, td + 1, tz) - 1;
		return { from: iso(midnight(fy, fm, fd, tz)), to: iso(Math.min(to, now)) };
	}
	if (spec.key === 'today' || spec.key === 'week') {
		const t = zonedDate(now, tz);
		// Weeks start on Monday, as in the portal's en-GB formatting.
		const back = spec.key === 'week' ? (t.weekday + 6) % 7 : 0;
		return { from: iso(midnight(t.y, t.m, t.d - back, tz)), to: iso(now) };
	}
	const r = parseRelative(spec.key) ?? parseRelative(DEFAULT_RANGE.key)!;
	const from = new Date(now);
	if (r.unit === 'mo') from.setUTCMonth(from.getUTCMonth() - r.n);
	else if (r.unit === 'y') from.setUTCFullYear(from.getUTCFullYear() - r.n);
	else from.setTime(now - r.n * { m: 60_000, h: 3_600_000, d: DAY, w: 7 * DAY }[r.unit]);
	return { from: from.toISOString(), to: iso(now) };
}

/**
 * The time range a page shows: the URL's own range, else the one the user
 * last picked (cookie, like Kibana's global time), else the default.
 */
export function parseRange(
	p: URLSearchParams,
	now = Date.now(),
	{ fallback = DEFAULT_RANGE, tz = 'UTC' }: { fallback?: RangeSpec; tz?: string } = {}
): TimeRange & { spec: RangeSpec } {
	const spec = specFromParams(p) ?? fallback;
	return { ...boundsOf(spec, now, cleanTimeZone(tz)), spec };
}

/** parseRange for a request: falls back to the `range` cookie, zone from the `tz` cookie. */
export function requestRange(
	url: URL,
	cookies: { get(name: string): string | undefined },
	now = Date.now()
) {
	return parseRange(url.searchParams, now, {
		fallback: specFromCookie(cookies.get('range')) ?? DEFAULT_RANGE,
		tz: cookies.get('tz')
	});
}

export function parseAlertQuery(
	p: URLSearchParams,
	now = Date.now(),
	range: TimeRange = parseRange(p, now)
): AlertQuery {
	return {
		search: cleanSearch(p.get('q')),
		severities: many<Severity>(p, 'severity', SEVERITIES),
		statuses: many<WorkflowStatus>(p, 'status', WORKFLOW_STATUSES),
		kinds: many<AlertKind>(p, 'kind', ALERT_KINDS),
		ruleIds: freeMany(p, 'rule', /^[A-Za-z0-9-]{1,64}$/),
		hostname: cleanSearch(p.get('host')),
		range: { from: range.from, to: range.to },
		sort: one<AlertSortField>(
			p,
			'sort',
			['timestamp', 'severity', 'ruleName', 'hostname', 'status'],
			'timestamp'
		),
		dir: one<SortDirection>(p, 'dir', ['asc', 'desc'], 'desc'),
		...pageParams(p)
	};
}
