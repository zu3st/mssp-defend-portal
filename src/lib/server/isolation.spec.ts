/**
 * Tenant isolation against the synthetic multi-customer mock cluster.
 * Each Portal instance corresponds to one container's configuration.
 */
import { describe, expect, it } from 'vitest';
import type { AgentQuery, AlertQuery } from '#lib/contract.ts';
import { loadConfig, ConfigError, type TenantScope } from './config';
import type { DataSource } from './datasource/types';
import { MockDataSource } from './mock/source';
import { buildMockWorld } from './mock/world';
import { Portal, ScopeViolationError } from './portal';
import { parseAgentQuery, parseAlertQuery } from './params';

const world = buildMockWorld(Date.parse('2026-10-24T12:00:00.000Z'));
const source = new MockDataSource(world);

const scope = (id: string, policies: string[], ns = id): TenantScope => ({
	id,
	name: id,
	spaceId: id,
	agentPolicyIds: policies,
	namespaces: [ns],
	alertsIndex: `.alerts-security.alerts-${id}`
});
const ACME = scope('acme', ['acme-workstations', 'acme-servers']);
const GLOBEX = scope('globex', ['globex-endpoints']);
const acme = new Portal(ACME, source);
const globex = new Portal(GLOBEX, source);

const range = { from: '2026-08-01T00:00:00.000Z', to: '2026-10-25T00:00:00.000Z' };
const allAgents: AgentQuery = { sort: 'hostname', dir: 'asc', page: 1, pageSize: 100 };
const allAlerts: AlertQuery = { range, sort: 'timestamp', dir: 'desc', page: 1, pageSize: 100 };

async function allAlertIds(p: Portal) {
	const ids: string[] = [];
	for (let page = 1; ; page++) {
		const r = await p.alerts({ ...allAlerts, page });
		ids.push(...r.items.map((a) => a.id));
		if (page * 100 >= r.total) return ids;
	}
}

describe('agents', () => {
	it('each tenant only sees agents of its own policies', async () => {
		const a = await acme.agents(allAgents);
		const g = await globex.agents(allAgents);
		expect(a.total).toBeGreaterThan(0);
		expect(g.total).toBeGreaterThan(0);
		expect(a.items.every((x) => ACME.agentPolicyIds.includes(x.policyId!))).toBe(true);
		expect(g.items.every((x) => x.policyId === 'globex-endpoints')).toBe(true);
		const overlap = a.items.filter((x) => g.items.some((y) => y.agentId === x.agentId));
		expect(overlap).toEqual([]);
	});

	it("cannot open another tenant's agent by id", async () => {
		const globexAgent = (await globex.agents(allAgents)).items[0];
		expect(await acme.agent(globexAgent.agentId)).toBeNull();
		expect(await globex.agent(globexAgent.agentId)).not.toBeNull();
	});

	it('a foreign policy filter yields nothing, not everything', async () => {
		const r = await acme.agents(parseAgentQuery(new URLSearchParams('policy=globex-endpoints')));
		expect(r.total).toBe(0);
		const mixed = await acme.agents(
			parseAgentQuery(new URLSearchParams('policy=globex-endpoints&policy=acme-servers&size=100'))
		);
		expect(mixed.items.every((x) => x.policyId === 'acme-servers')).toBe(true);
	});

	it("searching for another tenant's hostname finds nothing", async () => {
		const r = await acme.agents({ ...allAgents, search: 'GLBX' });
		expect(r.total).toBe(0);
	});

	it('status summary and tag facets only count own agents', async () => {
		const list = await acme.agentList(allAgents);
		const own = (await acme.agents({ ...allAgents, pageSize: 100 })).total;
		expect(list.statusSummary.total).toBeLessThanOrEqual(own);
		const f = await acme.agentFacets();
		expect(f.tags).not.toContain('globex');
	});

	it('agent alert counts only include own alerts', async () => {
		const list = await acme.agentList(allAgents);
		const total = list.items.reduce((s, h) => s + h.alerts.total, 0);
		const ownAlerts = (await allAlertIds(acme)).length;
		expect(total).toBeLessThanOrEqual(ownAlerts);
	});

	it('facets only list own policies', async () => {
		const f = await acme.agentFacets();
		expect(f.policies.map((p) => p.id).sort()).toEqual(['acme-servers', 'acme-workstations']);
	});
});

describe('alerts', () => {
	it('alert sets are disjoint between tenants', async () => {
		const a = new Set(await allAlertIds(acme));
		const g = await allAlertIds(globex);
		expect(a.size).toBeGreaterThan(0);
		expect(g.length).toBeGreaterThan(0);
		expect(g.filter((id) => a.has(id))).toEqual([]);
	});

	it('globex alerts leaked into the acme space index are filtered by namespace', async () => {
		const leaked = world.alertIndices
			.get('.alerts-security.alerts-acme')!
			.filter((h) => (h._source.data_stream as { namespace: string })?.namespace === 'globex');
		expect(leaked.length).toBeGreaterThan(0); // the trap exists
		const visible = new Set(await allAlertIds(acme));
		expect(leaked.some((h) => visible.has(h._source['kibana.alert.uuid'] as string))).toBe(false);
		expect(await acme.alert(leaked[0]._source['kibana.alert.uuid'] as string)).toBeNull();
	});

	it("cannot open another tenant's alert by id", async () => {
		const g = (await globex.alerts(allAlerts)).items[0];
		expect(await acme.alert(g.id)).toBeNull();
		expect((await globex.alert(g.id))?.id).toBe(g.id);
	});

	it("host filter on another tenant's agent id returns nothing", async () => {
		const g = (await globex.agents(allAgents)).items[0];
		const r = await acme.alerts({ ...allAlerts, agentId: g.agentId });
		expect(r.total).toBe(0);
	});

	it('stats and rule facets are tenant-local', async () => {
		const s = await acme.alertStats(range);
		expect(s.stats.total).toBe((await allAlertIds(acme)).length);
		expect(
			s.recent.every((x) => x.hostname?.startsWith('ACME') || x.hostname?.startsWith('acme'))
		).toBe(true);
	});

	it('crafted query params cannot widen scope', async () => {
		const q = parseAlertQuery(
			new URLSearchParams(
				'space=globex&index=.alerts-security.alerts-*&tenant=globex&host=GLBX-WS-001&size=100'
			)
		);
		const r = await acme.alerts({ ...q, range });
		expect(r.total).toBe(0);
	});

	it('rule facet lists source rules by uuid, and filtering by one works', async () => {
		const { rules } = await acme.alertFacets(range);
		expect(rules.map((r) => r.name)).toContain('Endpoint Security (Elastic Defend)');
		// Overridden per-alert names (Defend messages) are not facet entries.
		expect(rules.some((r) => r.name.startsWith('Malicious Behavior'))).toBe(false);
		const endpoint = rules.find((r) => r.name.startsWith('Endpoint Security'))!;
		const r = await acme.alerts({ ...allAlerts, ruleIds: [endpoint.id] });
		expect(r.total).toBeGreaterThan(0);
		expect(r.items.every((x) => x.kind !== 'rule')).toBe(true);
		// globex's rule uuids select nothing in acme.
		const g = (await globex.alertFacets(range)).rules.map((x) => x.id);
		expect((await acme.alerts({ ...allAlerts, ruleIds: g })).total).toBe(0);
	});

	it('detection rule names resolve only within the own space', async () => {
		const g = (await globex.alerts(allAlerts)).items[0];
		const gd = await globex.alert(g.id);
		expect(gd?.detectionRule.name).toBeDefined();
		// The same rule uuid looked up in acme's space resolves to nothing.
		expect(await source.detectionRuleName(ACME, gd!.detectionRule.uuid!)).toBeUndefined();
	});

	it('detail responses contain no internal metadata', async () => {
		const a = (await acme.alerts(allAlerts)).items[0];
		const json = JSON.stringify(await acme.alert(a.id));
		expect(json).not.toContain('rule.parameters');
		expect(json).not.toContain('execution.uuid');
		expect(json).not.toContain('artifacts');
		expect(json).not.toContain('space_ids');
	});
});

describe('fail closed', () => {
	/** A data source that "forgets" to apply scope. */
	class LeakySource extends MockDataSource {
		constructor() {
			super(world);
		}
		override async listAgents(_s: TenantScope, q: AgentQuery) {
			return super.listAgents(GLOBEX, q);
		}
		override async searchAlerts(_s: TenantScope, q: AlertQuery) {
			return super.searchAlerts(GLOBEX, q);
		}
	}

	it('foreign records from a buggy source raise instead of rendering', async () => {
		const p = new Portal(ACME, new LeakySource() as DataSource);
		await expect(p.agents(allAgents)).rejects.toBeInstanceOf(ScopeViolationError);
		await expect(p.alerts(allAlerts)).rejects.toBeInstanceOf(ScopeViolationError);
	});
});

describe('config', () => {
	const base = {
		TENANT_ID: 'acme',
		TENANT_AGENT_POLICY_IDS: 'p1',
		TENANT_NAMESPACES: 'acme',
		SESSION_SECRET: 's'.repeat(32),
		ORIGIN: 'https://portal.acme.example',
		OIDC_ISSUER: 'https://idm.acme.example/oauth2/openid/portal-acme',
		OIDC_CLIENT_ID: 'portal-acme',
		OIDC_CLIENT_SECRET: 'secret',
		OIDC_REQUIRED_GROUP: 'portal_users@idm.acme.example'
	};

	it('requires tenant policies and namespaces (fail closed)', () => {
		expect(() => loadConfig({ ...base, TENANT_AGENT_POLICY_IDS: '' })).toThrow(ConfigError);
		expect(() => loadConfig({ ...base, TENANT_NAMESPACES: ' , ' })).toThrow(ConfigError);
		expect(() => loadConfig({ ...base, TENANT_ID: '../evil' })).toThrow(ConfigError);
	});

	it('requires Elastic credentials in elastic mode', () => {
		expect(() => loadConfig({ ...base, DATA_SOURCE: 'elastic' })).toThrow(/ELASTICSEARCH_URL/);
	});

	it('rejects numbers that are not whole numbers', () => {
		expect(() => loadConfig({ ...base, SESSION_TTL_SECONDS: '8h' })).toThrow(/SESSION_TTL_SECONDS/);
		expect(() => loadConfig({ ...base, SESSION_TTL_SECONDS: '30' })).toThrow(/at least 60/);
		expect(loadConfig({ ...base, SESSION_TTL_SECONDS: ' 3600 ' }).auth.sessionTtlSeconds).toBe(
			3600
		);
		expect(loadConfig(base).auth.sessionTtlSeconds).toBe(8 * 3600);
	});

	it('requires a public origin and an https identity provider', () => {
		expect(() => loadConfig({ ...base, ORIGIN: '' })).toThrow(/ORIGIN/);
		expect(() => loadConfig({ ...base, ORIGIN: 'https://portal.acme.example/app' })).toThrow(
			/ORIGIN/
		);
		expect(() => loadConfig({ ...base, OIDC_ISSUER: 'http://idm.acme.example' })).toThrow(
			/OIDC_ISSUER/
		);
		expect(() => loadConfig({ ...base, OIDC_REQUIRED_GROUP: '' })).toThrow(/OIDC_REQUIRED_GROUP/);
		expect(
			loadConfig({ ...base, ORIGIN: 'https://a.example/, https://b.example' }).auth.origins
		).toEqual(['https://a.example', 'https://b.example']);
	});

	it('derives the space alias', () => {
		expect(loadConfig(base).tenant.alertsIndex).toBe('.alerts-security.alerts-acme');
	});
});
