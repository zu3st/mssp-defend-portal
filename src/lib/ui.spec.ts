import { describe, expect, it } from 'vitest';
import { componentLine, groupIntegrations } from './ui';
import { rangeLabel, specFromCookie, specToCookie } from './range';

describe('groupIntegrations', () => {
	it('groups the real lab components into recognisable rows', () => {
		// Components as reported by a real Elastic Agent 9.5.5 (lab, Acme – Servers).
		const rows = groupIntegrations([
			{ id: 'log-default', type: 'log', status: 'HEALTHY' },
			{ id: 'system/metrics-default', type: 'system/metrics', status: 'HEALTHY' },
			{ id: 'filestream-monitoring', type: 'filestream', status: 'HEALTHY' },
			{ id: 'http/metrics-monitoring', type: 'http/metrics', status: 'HEALTHY' }
		]);
		expect(rows.map((r) => r.name)).toEqual(['System metrics', 'Logs', 'Elastic Agent monitoring']);
	});

	it('puts Elastic Defend first and keeps the worst status with its message', () => {
		const rows = groupIntegrations([
			{ id: 'filestream-monitoring', type: 'filestream', status: 'HEALTHY', message: 'ok' },
			{ id: 'http/metrics-monitoring', type: 'http/metrics', status: 'DEGRADED', message: 'slow' },
			{ id: 'endpoint-default', type: 'endpoint', status: 'FAILED', message: 'must run as root' }
		]);
		expect(rows).toEqual([
			{ name: 'Elastic Defend', status: 'FAILED', message: 'must run as root' },
			{ name: 'Elastic Agent monitoring', status: 'DEGRADED', message: 'slow' }
		]);
	});
});

describe('time range labels', () => {
	it('names ranges the way Kibana does', () => {
		expect(rangeLabel({ key: '1h' })).toBe('Last 1 hour');
		expect(rangeLabel({ key: '30m' })).toBe('Last 30 minutes');
		expect(rangeLabel({ key: 'week' })).toBe('This week');
		expect(rangeLabel({ key: 'custom', from: '2026-10-01', to: '2026-10-20' })).toBe(
			'1 Oct 2026 → 20 Oct 2026'
		);
	});

	it('round-trips through the cookie and rejects junk', () => {
		const custom = { key: 'custom', from: '2026-10-01', to: '2026-10-20' };
		expect(specFromCookie(specToCookie(custom))).toEqual(custom);
		expect(specFromCookie('24h')).toEqual({ key: '24h' });
		expect(specFromCookie('2026-10-20..2026-10-01')).toBeNull();
		expect(specFromCookie('<script>')).toBeNull();
	});
});

describe('componentLine', () => {
	it('says the status once', () => {
		expect(componentLine('HEALTHY', 'Healthy')).toBe('Healthy');
		expect(componentLine('HEALTHY', "Healthy: communicating with pid '4412'")).toBe(
			"Healthy · communicating with pid '4412'"
		);
		expect(componentLine('DEGRADED', 'Degraded: kernel driver failed to load')).toBe(
			'Degraded · kernel driver failed to load'
		);
		expect(componentLine('FAILED', 'Elastic Agent must be running as root')).toBe(
			'Failed · Elastic Agent must be running as root'
		);
		expect(componentLine('STARTING')).toBe('Starting');
	});
});
