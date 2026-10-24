import { describe, expect, it } from 'vitest';
import type { RawEndpointMetadata, RawFleetAgent } from '../elastic/raw';
import { defendHealth, fleetStatusGroup, normalizeAgent } from './agents';

const agent = (
	over: Partial<RawFleetAgent> = {},
	endpointStatus: string | null = 'HEALTHY'
): RawFleetAgent => ({
	id: 'agent-1',
	active: true,
	status: 'online',
	policy_id: 'acme-workstations',
	last_checkin: '2026-10-24T08:00:00.000Z',
	components: endpointStatus
		? [{ id: 'endpoint-default', type: 'endpoint', status: endpointStatus, message: 'msg' }]
		: [],
	local_metadata: {
		host: { hostname: 'ACME-WS-001', id: 'host-1', ip: ['10.10.50.10'] },
		os: { name: 'Windows', version: '10.0' },
		elastic: { agent: { version: '9.1.4' } }
	},
	...over
});

const meta = (status: string, isolation = false): RawEndpointMetadata => ({
	metadata: {
		'@timestamp': 1_761_292_800_000,
		agent: { id: 'agent-1', version: '9.1.4' },
		Endpoint: { policy: { applied: { name: 'Defend', status } }, state: { isolation } }
	}
});

describe('Elastic Defend policy status (Kibana Endpoints semantics)', () => {
	it.each(['success', 'warning', 'failure'] as const)('reports the policy response "%s"', (r) => {
		expect(defendHealth(agent(), meta(r)).status).toBe(r);
	});

	it('is independent of Fleet agent status: healthy agent, failed policy', () => {
		const a = normalizeAgent(agent(), meta('failure'), { policyNames: new Map() });
		expect(a.fleetStatus).toBe('online');
		expect(a.defend.status).toBe('failure');
	});

	it('a failed component does not invent a policy status', () => {
		const h = defendHealth(agent({ status: 'error' }, 'FAILED'), meta('success'));
		expect(h.status).toBe('success');
		expect(h.componentStatus).toBe('FAILED');
	});

	it('offline agent keeps the last reported policy status, like Kibana', () => {
		const h = defendHealth(agent({ status: 'offline' }), meta('success', true));
		expect(h.status).toBe('success');
		expect(h.isolated).toBe(true);
	});

	it('Defend installed but no valid policy response is unknown', () => {
		expect(defendHealth(agent(), undefined).status).toBe('unknown');
		expect(defendHealth(agent(), meta('bogus')).status).toBe('unknown');
	});

	it('agent without Defend component or metadata is not_installed', () => {
		expect(defendHealth(agent({}, null), undefined).status).toBe('not_installed');
	});
});

describe('normalizeAgent', () => {
	it('converts Fleet metrics like the Fleet UI (CPU %, memory bytes)', () => {
		const a = normalizeAgent(
			agent({ metrics: { cpu_avg: 0.0123, memory_size_byte_avg: 217_000_000 } }),
			undefined,
			{ policyNames: new Map() }
		);
		expect(a.cpuPercent).toBe(1.23);
		expect(a.memoryBytes).toBe(217_000_000);
		expect(
			normalizeAgent(agent(), undefined, { policyNames: new Map() }).cpuPercent
		).toBeUndefined();
	});

	it('maps Fleet fields and policy names', () => {
		const a = normalizeAgent(agent(), meta('success'), {
			policyNames: new Map([['acme-workstations', 'Acme – Workstations']]),
			latestVersion: '9.1.5'
		});
		expect(a).toMatchObject({
			agentId: 'agent-1',
			hostId: 'host-1',
			hostname: 'ACME-WS-001',
			ips: ['10.10.50.10'],
			agentVersion: '9.1.4',
			fleetStatus: 'online',
			policyName: 'Acme – Workstations',
			upgradeAvailable: true,
			defend: { status: 'success', endpointVersion: '9.1.4' }
		});
	});

	it('unknown Fleet status falls back conservatively', () => {
		expect(
			normalizeAgent(agent({ status: 'weird' }), undefined, { policyNames: new Map() }).fleetStatus
		).toBe('error');
	});

	it('groups statuses like Fleet', () => {
		expect(fleetStatusGroup('degraded')).toBe('unhealthy');
		expect(fleetStatusGroup('unenrolling')).toBe('updating');
		expect(fleetStatusGroup('orphaned')).toBe('orphaned');
		expect(fleetStatusGroup('uninstalled')).toBe('uninstalled');
	});
});
