import { describe, expect, it } from 'vitest';
import type { TenantScope } from '../config';
import { isAllowed } from './http';
import {
	agentKuery,
	alertAggregatesBody,
	alertByIdBody,
	alertCountsByAgentBody,
	alertSearchBody,
	kqlEscapeWildcard,
	kqlQuote,
	ruleIdsBody
} from './queries';

const scope: TenantScope = {
	id: 'acme',
	name: 'Acme',
	spaceId: 'acme',
	agentPolicyIds: ['acme-workstations', 'acme-servers'],
	namespaces: ['acme'],
	alertsIndex: '.alerts-security.alerts-acme'
};
const range = { from: '2026-10-01T00:00:00.000Z', to: '2026-10-24T00:00:00.000Z' };

const SCOPE_CLAUSES = [
	{ term: { 'kibana.space_ids': 'acme' } },
	{ terms: { 'data_stream.namespace': ['acme'] } }
];

describe('KQL', () => {
	it('quotes and escapes literals', () => {
		expect(kqlQuote('a"b\\c')).toBe('"a\\"b\\\\c"');
		expect(kqlEscapeWildcard('a*b (c) or:d')).toBe('a\\*b\\ \\(c\\)\\ or\\:d');
	});

	it('always ANDs the tenant policy scope first', () => {
		const k = agentKuery(scope, {
			search: 'ws',
			statuses: ['online'],
			versions: ['9.1.4'],
			policyIds: ['acme-servers']
		});
		expect(k.startsWith('(policy_id:("acme-workstations" or "acme-servers")) and ')).toBe(true);
		expect(k).toContain('(policy_id:("acme-servers"))');
		expect(k).toContain('status:(online)');
		expect(k).toContain('local_metadata.host.hostname:*ws*');
	});

	it('an injected "or" in search cannot widen the scope', () => {
		const k = agentKuery(scope, { search: 'x or policy_id:*' });
		expect(k).toContain('*x\\ or\\ policy_id\\:\\**');
	});
});

describe('alert query bodies', () => {
	const q = { range, sort: 'timestamp' as const, dir: 'desc' as const, page: 3, pageSize: 25 };

	it.each([
		['search', alertSearchBody(scope, q).query.bool.filter],
		['byId', alertByIdBody(scope, 'x').query.bool.filter],
		['aggregates', alertAggregatesBody(scope, range).query.bool.filter],
		['countsByAgent', alertCountsByAgentBody(scope, ['a']).query.bool.filter],
		['ruleIds', ruleIdsBody(scope, range).query.bool.filter]
	])('%s carries the tenant scope filter', (_, filter) => {
		expect(filter).toEqual(expect.arrayContaining(SCOPE_CLAUSES));
	});

	it('paginates with from/size and requests only allowlisted fields', () => {
		const b = alertSearchBody(scope, q);
		expect(b.from).toBe(50);
		expect(b.size).toBe(25);
		expect(b._source.includes).toContain('kibana.alert.severity');
		expect(b._source.includes).not.toContain('kibana.alert.rule.parameters');
	});

	it('never exceeds the result window', () => {
		const b = alertSearchBody(scope, { ...q, page: 400, pageSize: 25 });
		expect(b.from + b.size).toBeLessThanOrEqual(10_000);
	});

	it('sorts severity by risk score', () => {
		expect(alertSearchBody(scope, { ...q, sort: 'severity' }).sort[0]).toHaveProperty([
			'kibana.alert.risk_score'
		]);
	});

	it('escapes wildcard search', () => {
		const f = alertSearchBody(scope, { ...q, search: 'a*b?' }).query.bool.filter;
		expect(JSON.stringify(f)).toContain('*a\\\\*b\\\\?*');
	});
});

describe('read-only request allowlist', () => {
	it('allows only the read APIs we use', () => {
		expect(isAllowed('kibana', 'GET', '/s/acme/api/fleet/agents')).toBe(true);
		expect(isAllowed('es', 'POST', '/.alerts-security.alerts-acme/_search')).toBe(true);
		expect(isAllowed('kibana', 'GET', '/s/acme/api/detection_engine/rules')).toBe(true);
	});

	it.each([
		['kibana', 'POST', '/s/acme/api/detection_engine/signals/status'],
		['kibana', 'PUT', '/s/acme/api/detection_engine/rules'],
		['kibana', 'GET', '/s/acme/api/detection_engine/rules/_export'],
		['kibana', 'POST', '/s/acme/api/fleet/agents/abc/unenroll'],
		['kibana', 'POST', '/api/endpoint/action/isolate'],
		['kibana', 'PUT', '/s/acme/api/fleet/agent_policies'],
		['kibana', 'GET', '/s/acme/api/fleet/agents/abc/../../../api/security/role'],
		['es', 'POST', '/.alerts-security.alerts-acme/_update_by_query'],
		['es', 'POST', '/.alerts-security.alerts-*/_search'],
		['es', 'POST', '/.fleet-agents/_search'],
		['es', 'DELETE', '/.alerts-security.alerts-acme'],
		['es', 'GET', '/_cat/indices']
	] as const)('refuses %s %s %s', (target, method, path) => {
		expect(isAllowed(target, method, path)).toBe(false);
	});
});
