import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TenantScope } from '../config';
import { ElasticDataSource } from './source';

const scope: TenantScope = {
	id: 'acme',
	name: 'Acme',
	spaceId: 'acme',
	agentPolicyIds: ['acme-workstations'],
	namespaces: ['acme'],
	alertsIndex: '.alerts-security.alerts-acme'
};
const source = () =>
	new ElasticDataSource({
		elasticsearchUrl: 'http://es.test',
		kibanaUrl: 'http://kibana.test',
		apiKey: 'test',
		requestTimeoutMs: 1000
	});

/**
 * A Fleet that answers the agent list with the newest version the kuery does
 * not exclude (or always `stuck`, as if it ignored the filter).
 */
function fakeFleet(versions: string[], stuck?: string) {
	const agentRequests: URL[] = [];
	vi.stubGlobal('fetch', async (input: URL) => {
		const url = new URL(input);
		if (url.pathname.endsWith('/agents/tags')) return Response.json({ items: ['vip'] });
		agentRequests.push(url);
		const kuery = url.searchParams.get('kuery') ?? '';
		const v = stuck ?? versions.find((x) => !kuery.includes(`"${x}"`));
		const items = v ? [{ id: 'a', local_metadata: { elastic: { agent: { version: v } } } }] : [];
		return Response.json({ items, total: items.length, page: 1, perPage: 1 });
	});
	return agentRequests;
}

afterEach(() => vi.unstubAllGlobals());

describe('agent version filter options', () => {
	it('lists each version with one small request, plus one to confirm the end', async () => {
		const requests = fakeFleet(['9.5.5', '9.4.0', '8.19.2']);
		const facets = await source().agentFacetValues(scope);
		expect(facets).toEqual({ versions: ['9.5.5', '9.4.0', '8.19.2'], tags: ['vip'] });
		expect(requests).toHaveLength(4);
		for (const r of requests) {
			expect(r.pathname).toBe('/s/acme/api/fleet/agents');
			expect(r.searchParams.get('perPage')).toBe('1');
			expect(r.searchParams.get('withMetrics')).toBeNull();
			expect(r.searchParams.get('kuery')).toMatch(/^\(policy_id:\("acme-workstations"\)\) and /);
		}
	});

	it('stops if Fleet ignores the filter', async () => {
		const requests = fakeFleet([], '9.5.5');
		expect((await source().agentFacetValues(scope)).versions).toEqual(['9.5.5']);
		expect(requests).toHaveLength(2);
	});

	it('stops at 50 versions', async () => {
		const many = Array.from({ length: 60 }, (_, i) => `9.${i}.0`);
		const requests = fakeFleet(many);
		expect((await source().agentFacetValues(scope)).versions).toHaveLength(50);
		expect(requests).toHaveLength(50);
	});
});
