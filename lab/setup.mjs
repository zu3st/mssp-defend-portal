// Lab tenant setup for the dedicated mssp-lab stack (idempotent).
//
//   docker run --rm --network mssp-lab_default -v "$PWD":/app -w /app \
//     --env-file lab/.env node:24.22.1-alpine node lab/setup.mjs
//
// Per tenant (Kibana space): agent policies with their own data-stream
// namespace (Elastic Defend on some), the prebuilt "Endpoint Security (Elastic
// Defend)" rule installed and enabled, Fleet enrollment tokens (appended to
// lab/.env for the agent containers) and a read-only, tenant-scoped API key in
// secrets/<tenant>/elastic_api_key for the portal container.
import { mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';

const ES = 'http://elasticsearch:9200';
const KB = 'http://kibana:5601';
const auth = 'Basic ' + Buffer.from(`elastic:${process.env.ELASTIC_PASSWORD}`).toString('base64');
const ENDPOINT_RULE_ID = '9a1a2dae-0b5f-4c3d-8305-a268d404c306';

const TENANTS = [
	{
		id: 'acme',
		name: 'Acme Corp',
		policies: [
			{
				id: 'acme-workstations',
				name: 'Acme – Workstations',
				defend: true,
				token: 'ACME_WORKSTATIONS_TOKEN'
			},
			{ id: 'acme-servers', name: 'Acme – Servers', defend: false, token: 'ACME_SERVERS_TOKEN' }
		]
	},
	{
		id: 'globex',
		name: 'Globex Inc',
		policies: [
			{
				id: 'globex-endpoints',
				name: 'Globex – Endpoints',
				defend: true,
				token: 'GLOBEX_ENDPOINTS_TOKEN'
			}
		]
	}
];

async function call(base, method, path, body, extraHeaders = {}) {
	const res = await fetch(base + path, {
		method,
		headers: {
			Authorization: auth,
			'Content-Type': 'application/json',
			'kbn-xsrf': 'lab-setup',
			...(base === KB ? { 'elastic-api-version': '2023-10-31' } : {}),
			...extraHeaders
		},
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	const text = await res.text();
	let json;
	try {
		json = text ? JSON.parse(text) : {};
	} catch {
		json = { raw: text };
	}
	return { status: res.status, json };
}
const kb = (method, path, body, h) => call(KB, method, path, body, h);
const es = (method, path, body) => call(ES, method, path, body);

function must(r, what, ok = [200]) {
	if (!ok.includes(r.status))
		throw new Error(`${what}: HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 400)}`);
	return r.json;
}

async function ensureSpace(t) {
	const r = await kb('GET', `/api/spaces/space/${t.id}`);
	if (r.status === 200) return console.log(`space ${t.id}: exists`);
	must(
		await kb('POST', '/api/spaces/space', { id: t.id, name: t.name, solution: 'security' }),
		`create space ${t.id}`
	);
	console.log(`space ${t.id}: created`);
}

async function ensurePolicy(t, p) {
	const s = `/s/${t.id}`;
	const r = await kb('GET', `${s}/api/fleet/agent_policies/${p.id}`);
	if (r.status !== 200) {
		must(
			await kb('POST', `${s}/api/fleet/agent_policies?sys_monitoring=true`, {
				id: p.id,
				name: p.name,
				namespace: t.id,
				monitoring_enabled: ['logs', 'metrics']
			}),
			`create policy ${p.id}`
		);
		console.log(`policy ${p.id}: created (namespace ${t.id})`);
	} else console.log(`policy ${p.id}: exists`);

	if (!p.defend) return;
	const pp = await kb(
		'GET',
		`${s}/api/fleet/package_policies?kuery=${encodeURIComponent(`ingest-package-policies.policy_ids:"${p.id}" and ingest-package-policies.package.name:endpoint`)}`
	);
	if (must(pp, 'list package policies').items?.length)
		return console.log(`  Elastic Defend on ${p.id}: exists`);
	const pkg = must(await kb('GET', '/api/fleet/epm/packages/endpoint'), 'endpoint package').item;
	must(
		await kb('POST', `${s}/api/fleet/package_policies`, {
			name: `Elastic Defend – ${p.id}`,
			namespace: t.id,
			policy_ids: [p.id],
			package: { name: 'endpoint', version: pkg.version },
			inputs: [
				{
					type: 'endpoint',
					enabled: true,
					streams: [],
					config: {
						integration_config: {
							value: { type: 'endpoint', endpointConfig: { preset: 'EDRComplete' } }
						}
					}
				}
			]
		}),
		`add Elastic Defend to ${p.id}`
	);
	console.log(`  Elastic Defend on ${p.id}: added (package ${pkg.version})`);
}

async function enrollmentToken(t, p) {
	const r = must(
		await kb(
			'GET',
			`/s/${t.id}/api/fleet/enrollment_api_keys?kuery=${encodeURIComponent(`policy_id:"${p.id}"`)}`
		),
		`enrollment tokens for ${p.id}`
	);
	const key = (r.items ?? r.list ?? []).find((k) => k.active && k.policy_id === p.id);
	if (!key) throw new Error(`no active enrollment token for ${p.id}`);
	return key.api_key;
}

/** Install and enable only the prebuilt Endpoint Security rule in this space. */
async function ensureEndpointRule(t) {
	const s = `/s/${t.id}`;
	let r = await kb('GET', `${s}/api/detection_engine/rules?rule_id=${ENDPOINT_RULE_ID}`);
	if (r.status === 404) {
		// The prebuilt rules package is fetched from the Elastic package registry.
		const internal = { 'elastic-api-version': '1' };
		const review = must(
			await kb(
				'POST',
				`${s}/internal/detection_engine/prebuilt_rules/installation/_review`,
				{},
				internal
			),
			'review prebuilt rules'
		);
		const rule = review.rules?.find((x) => x.rule_id === ENDPOINT_RULE_ID);
		if (!rule) throw new Error('Endpoint Security rule not offered by the prebuilt rules package');
		must(
			await kb(
				'POST',
				`${s}/internal/detection_engine/prebuilt_rules/installation/_perform`,
				{ mode: 'SPECIFIC_RULES', rules: [{ rule_id: ENDPOINT_RULE_ID, version: rule.version }] },
				internal
			),
			'install Endpoint Security rule'
		);
		r = await kb('GET', `${s}/api/detection_engine/rules?rule_id=${ENDPOINT_RULE_ID}`);
	}
	const rule = must(r, 'read Endpoint Security rule');
	if (!rule.enabled) {
		must(
			await kb('PATCH', `${s}/api/detection_engine/rules`, {
				rule_id: ENDPOINT_RULE_ID,
				enabled: true
			}),
			'enable rule'
		);
	}
	console.log(
		`rule "${rule.name}" in ${t.id}: enabled (uuid ${rule.id}, interval ${rule.interval}, from ${rule.from})`
	);
	return rule;
}

/** Kibana read privileges the portal needs, named as this Kibana version names them. */
async function kibanaReadPrivileges() {
	const r = must(await kb('GET', '/api/security/privileges'), 'list Kibana privileges');
	const features = r.features ?? {};
	const pick = (re) => Object.keys(features).filter((f) => re.test(f));
	const fleet = pick(/^fleetv2$|^fleet$/);
	const newest = (re) =>
		pick(re)
			.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
			.slice(-1);
	const siem = newest(/^siem(V\d+)?$/); // alerts and endpoint list
	const rules = newest(/^securitySolutionRulesV\d+$/); // rules-read, for the detection rule name
	const privs = [...fleet, ...siem, ...rules].map((f) => `feature_${f}.read`);
	// Endpoint metadata API is behind the Endpoint List sub-feature.
	for (const f of siem) {
		const sub = (features[f] ?? []).find((p) => /endpoint_list_read/.test(p));
		if (sub) privs.push(`feature_${f}.${sub}`);
	}
	return privs;
}

async function tenantApiKey(t, privileges) {
	// Replace, don't accumulate: invalidate earlier keys issued for this tenant.
	must(
		await es('DELETE', '/_security/api_key', { name: `portal-${t.id}` }),
		`invalidate old keys for ${t.id}`,
		[200, 404]
	);
	const r = must(
		await es('POST', '/_security/api_key', {
			name: `portal-${t.id}`,
			role_descriptors: {
				[`portal_${t.id}_read`]: {
					cluster: [],
					indices: [
						{
							names: [`.alerts-security.alerts-${t.id}`],
							privileges: ['read'],
							query: {
								bool: {
									filter: [
										{ term: { 'kibana.space_ids': t.id } },
										{ terms: { 'data_stream.namespace': [t.id] } }
									]
								}
							}
						},
						// Fleet computes agent CPU/memory (withMetrics) with the caller's own
						// credentials from the agents' monitoring streams. The tenant
						// namespace is part of the stream name, so this matches only its own.
						{ names: [`metrics-elastic_agent.*-${t.id}`], privileges: ['read'] }
					],
					applications: [
						{ application: 'kibana-.kibana', privileges, resources: [`space:${t.id}`] }
					]
				}
			},
			metadata: { portal_tenant: t.id, lab: true }
		}),
		`API key for ${t.id}`
	);
	const dir = `secrets/${t.id}`;
	mkdirSync(dir, { recursive: true });
	writeFileSync(`${dir}/elastic_api_key`, r.encoded + '\n', { mode: 0o644 });
	console.log(`API key portal-${t.id}: written to ${dir}/elastic_api_key`);
}

function upsertEnv(file, vars) {
	let s = readFileSync(file, 'utf8');
	for (const [k, v] of Object.entries(vars)) {
		const line = `${k}=${v}`;
		s = new RegExp(`^${k}=.*$`, 'm').test(s)
			? s.replace(new RegExp(`^${k}=.*$`, 'm'), line)
			: s.trimEnd() + '\n' + line + '\n';
	}
	writeFileSync(file, s);
	chmodSync(file, 0o600);
}

const tokens = {};
for (const t of TENANTS) {
	await ensureSpace(t);
	for (const p of t.policies) {
		await ensurePolicy(t, p);
		tokens[p.token] = await enrollmentToken(t, p);
	}
	await ensureEndpointRule(t);
}
upsertEnv('lab/.env', tokens);
console.log('enrollment tokens: written to lab/.env');

const privileges = await kibanaReadPrivileges();
console.log('Kibana privileges for portal keys:', privileges.join(', '));
for (const t of TENANTS) await tenantApiKey(t, privileges);
console.log('done');
