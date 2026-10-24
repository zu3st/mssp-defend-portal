/**
 * Time ranges as Kibana's date picker offers them: relative ("Last 7 days"),
 * rounded ("Today", "This week") or absolute (a from/to date pair). Shared by
 * the picker (labels, URLs, cookie) and the server (bounds, see params.ts).
 *
 * URL form:    ?range=7d | ?range=today | ?range=custom&from=2026-10-01&to=2026-10-20
 * Cookie form: "7d" | "today" | "2026-10-01..2026-10-20"
 */
export interface RangeSpec {
	/** A relative key (`15m`, `24h`, `7d`, `today`, `week`, …) or `custom`. */
	key: string;
	/** `custom` only: inclusive calendar dates, YYYY-MM-DD. */
	from?: string;
	to?: string;
}

export const DEFAULT_RANGE: RangeSpec = { key: '7d' };

/** Kibana's default "Commonly used" list. */
export const COMMONLY_USED = ['today', 'week', '15m', '30m', '1h', '24h', '7d', '30d', '90d', '1y'];

export const UNITS = {
	m: 'minute',
	h: 'hour',
	d: 'day',
	w: 'week',
	mo: 'month',
	y: 'year'
} as const;
export type Unit = keyof typeof UNITS;

const UNIT_DAYS: Record<Unit, number> = { m: 1 / 1440, h: 1 / 24, d: 1, w: 7, mo: 31, y: 366 };
/** Longest range the portal queries; every relative and custom range is checked against it. */
export const MAX_RANGE_DAYS = 366;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseRelative(key: string): { n: number; unit: Unit } | null {
	const m = /^(\d{1,4})(mo|m|h|d|w|y)$/.exec(key);
	if (!m) return null;
	const n = Number(m[1]);
	const unit = m[2] as Unit;
	return n >= 1 && n * UNIT_DAYS[unit] <= MAX_RANGE_DAYS ? { n, unit } : null;
}

const isDate = (s: string | undefined | null): s is string =>
	!!s && DATE.test(s) && !Number.isNaN(Date.parse(s));

export function validSpec(spec: RangeSpec | null): RangeSpec | null {
	if (!spec) return null;
	if (spec.key === 'today' || spec.key === 'week' || parseRelative(spec.key))
		return { key: spec.key };
	if (spec.key === 'custom' && isDate(spec.from) && isDate(spec.to) && spec.from <= spec.to) {
		const days = (Date.parse(spec.to) - Date.parse(spec.from)) / 86_400_000 + 1;
		return days <= MAX_RANGE_DAYS ? { key: 'custom', from: spec.from, to: spec.to } : null;
	}
	return null;
}

export function specFromParams(p: URLSearchParams): RangeSpec | null {
	const key = p.get('range');
	return key
		? validSpec({ key, from: p.get('from') ?? undefined, to: p.get('to') ?? undefined })
		: null;
}

/** URL params for a range; `undefined` removes a param (see withParams). */
export function rangeParams(spec: RangeSpec): Record<string, string | undefined> {
	return spec.key === 'custom'
		? { range: 'custom', from: spec.from, to: spec.to }
		: { range: spec.key, from: undefined, to: undefined };
}

export function specToCookie(spec: RangeSpec): string {
	return spec.key === 'custom' ? `${spec.from}..${spec.to}` : spec.key;
}

export function specFromCookie(v: string | undefined): RangeSpec | null {
	if (!v) return null;
	const [from, to] = v.split('..');
	return validSpec(to === undefined ? { key: v } : { key: 'custom', from, to });
}

/** Calendar dates are shown as written, never shifted by a time zone. */
const dayFmt = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' });
const day = (d: string) => dayFmt.format(new Date(`${d}T00:00:00Z`));

export function rangeLabel(spec: RangeSpec): string {
	if (spec.key === 'today') return 'Today';
	if (spec.key === 'week') return 'This week';
	if (spec.key === 'custom' && spec.from && spec.to) {
		return spec.from === spec.to ? day(spec.from) : `${day(spec.from)} → ${day(spec.to)}`;
	}
	const r = parseRelative(spec.key);
	return r ? `Last ${r.n} ${UNITS[r.unit]}${r.n === 1 ? '' : 's'}` : spec.key;
}

export const sameRange = (a: RangeSpec, b: RangeSpec) =>
	a.key === b.key && a.from === b.from && a.to === b.to;

/** `path` with the current URL's time range (if any) carried over, e.g. for "Clear filters". */
export function withRange(
	path: string,
	url: { searchParams: { get(k: string): string | null } }
): string {
	const keep = new URLSearchParams();
	for (const k of ['range', 'from', 'to']) {
		const v = url.searchParams.get(k);
		if (v) keep.set(k, v);
	}
	const [base, query] = path.split('?');
	const all = new URLSearchParams(query);
	keep.forEach((v, k) => all.set(k, v));
	const qs = all.toString();
	return qs ? `${base}?${qs}` : base;
}
