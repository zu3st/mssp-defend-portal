import { describe, expect, it } from 'vitest';
import { parseAgentQuery, parseAlertQuery, parseRange } from './params';

const p = (s: string) => new URLSearchParams(s);
const NOW = Date.parse('2026-10-24T12:00:00.000Z');

describe('parseAlertQuery', () => {
	it('drops unknown enum values and dedupes', () => {
		const q = parseAlertQuery(
			p('severity=high&severity=bogus&severity=high&status=closed,open,false_positive&kind=memory'),
			NOW
		);
		expect(q.severities).toEqual(['high']);
		// false_positive is a closing reason, never a status.
		expect(q.statuses).toEqual(['closed', 'open']);
		expect(q.kinds).toEqual(['memory']);
	});

	it('clamps page size and page', () => {
		expect(parseAlertQuery(p('size=5000&page=-3'), NOW)).toMatchObject({ page: 1, pageSize: 25 });
		expect(parseAlertQuery(p('size=100&page=999999'), NOW)).toMatchObject({
			page: 100,
			pageSize: 100
		});
	});

	it('rejects unknown sort fields', () => {
		expect(parseAlertQuery(p('sort=kibana.alert.rule.parameters&dir=sideways'), NOW)).toMatchObject(
			{ sort: 'timestamp', dir: 'desc' }
		);
	});

	it('sanitizes search to a bounded literal', () => {
		const q = parseAlertQuery(p(`q=${encodeURIComponent('foo"}* OR {"script":1}')}`), NOW);
		expect(q.search).toBe('foo OR script:1');
		expect(parseAlertQuery(p(`q=${'a'.repeat(500)}`), NOW).search).toHaveLength(64);
	});
});

describe('parseRange', () => {
	const span = (r: { from: string; to: string }) => Date.parse(r.to) - Date.parse(r.from);

	it('defaults to the last 7 days', () => {
		const r = parseRange(p(''), NOW);
		expect(r.spec).toEqual({ key: '7d' });
		expect(span(r)).toBe(7 * 86_400_000);
	});

	it('parses Kibana-style relative ranges', () => {
		expect(span(parseRange(p('range=15m'), NOW))).toBe(15 * 60_000);
		expect(span(parseRange(p('range=24h'), NOW))).toBe(86_400_000);
		expect(parseRange(p('range=1y'), NOW).from).toBe('2025-10-24T12:00:00.000Z');
		expect(parseRange(p('range=3mo'), NOW).from).toBe('2026-07-24T12:00:00.000Z');
	});

	it('rounds Today and This week in the browser time zone', () => {
		// 2026-10-24 is a Saturday; Berlin is UTC+2 on that day.
		const today = parseRange(p('range=today'), NOW, { tz: 'Europe/Berlin' });
		expect(today.from).toBe('2026-10-23T22:00:00.000Z');
		const week = parseRange(p('range=week'), NOW, { tz: 'Europe/Berlin' });
		expect(week.from).toBe('2026-10-18T22:00:00.000Z');
		expect(parseRange(p('range=today'), NOW, { tz: 'Not/AZone' }).from).toBe(
			'2026-10-24T00:00:00.000Z'
		);
	});

	it('accepts a valid custom range and includes the whole "to" day', () => {
		const r = parseRange(p('range=custom&from=2026-10-01&to=2026-10-02'), NOW);
		expect(r).toMatchObject({ from: '2026-10-01T00:00:00.000Z', to: '2026-10-02T23:59:59.999Z' });
		const berlin = parseRange(p('range=custom&from=2026-10-01&to=2026-10-02'), NOW, {
			tz: 'Europe/Berlin'
		});
		expect(berlin.from).toBe('2026-09-30T22:00:00.000Z');
	});

	it('falls back on invalid, oversized or unknown ranges', () => {
		const fallback = { key: '30d' };
		for (const q of [
			'range=custom&from=2020-01-01&to=2026-01-01',
			'range=custom&from=nope&to=2026-01-01',
			'range=custom&from=2026-10-05&to=2026-10-01',
			'range=400d',
			'range=0d',
			'range=7x'
		]) {
			expect(parseRange(p(q), NOW, { fallback }).spec).toEqual(fallback);
		}
	});
});

describe('parseAgentQuery', () => {
	it('parses filters and drops junk', () => {
		const q = parseAgentQuery(
			p(
				'status=unhealthy&status=hacked&tag=server&upgrade=1&version=9.1.4&version=9;rm&policy=acme-servers&policy=../x&q=ACME-WS*&sort=lastCheckin&dir=desc'
			)
		);
		expect(q).toMatchObject({
			statusGroups: ['unhealthy'],
			// Fleet's "Unhealthy" covers both raw statuses.
			statuses: ['error', 'degraded'],
			tags: ['server'],
			upgradeAvailable: true,
			versions: ['9.1.4'],
			policyIds: ['acme-servers'],
			search: 'ACME-WS',
			sort: 'lastCheckin',
			dir: 'desc'
		});
	});

	it('defaults to the five statuses Fleet preselects', () => {
		const q = parseAgentQuery(p(''));
		expect(q.statusGroups).toEqual(['healthy', 'unhealthy', 'orphaned', 'updating', 'offline']);
		expect(q.statuses).not.toContain('inactive');
	});
});
