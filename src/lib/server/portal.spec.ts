import { describe, expect, it } from 'vitest';
import type { AgentQuery } from '#lib/contract.ts';
import type { TenantScope } from './config';
import { MockDataSource } from './mock/source';
import { buildMockWorld } from './mock/world';
import { Portal } from './portal';

const ACME: TenantScope = {
	id: 'acme',
	name: 'acme',
	spaceId: 'acme',
	agentPolicyIds: ['acme-workstations', 'acme-servers'],
	namespaces: ['acme'],
	alertsIndex: '.alerts-security.alerts-acme'
};
const range = { from: '2026-08-01T00:00:00.000Z', to: '2026-10-25T00:00:00.000Z' };

/** Counts the backend calls the portal makes. */
class CountingSource extends MockDataSource {
	calls: Record<string, number> = {};
	metrics: (boolean | undefined)[] = [];
	private count(name: string) {
		this.calls[name] = (this.calls[name] ?? 0) + 1;
	}
	override async listAgents(s: TenantScope, q: AgentQuery, opts?: { metrics?: boolean }) {
		this.count('listAgents');
		this.metrics.push(opts?.metrics);
		return super.listAgents(s, q);
	}
	override async agentPolicies(s: TenantScope) {
		this.count('agentPolicies');
		return super.agentPolicies(s);
	}
	override async alertAggregates(...args: Parameters<MockDataSource['alertAggregates']>) {
		this.count('alertAggregates');
		return super.alertAggregates(...args);
	}
}

describe('overview load on the backend', () => {
	it('shares the Defend sweep between loads but keeps detections live', async () => {
		const source = new CountingSource(buildMockWorld(Date.parse('2026-10-24T12:00:00.000Z')));
		const portal = new Portal(ACME, source);
		const [a, b] = await Promise.all([portal.overview(range), portal.overview(range)]);
		await portal.overview(range);
		expect(b.policy).toEqual(a.policy);
		// One sweep (one page for this small tenant), its context fetched once, no metrics.
		expect(source.calls.listAgents).toBe(1);
		expect(source.calls.agentPolicies).toBe(1);
		expect(source.metrics).toEqual([false]);
		expect(source.calls.alertAggregates).toBe(3);
	});

	it('still asks for metrics on the agent list', async () => {
		const source = new CountingSource(buildMockWorld(Date.parse('2026-10-24T12:00:00.000Z')));
		await new Portal(ACME, source).agentList({
			sort: 'hostname',
			dir: 'asc',
			page: 1,
			pageSize: 25
		});
		expect(source.metrics).toEqual([undefined]);
	});
});
