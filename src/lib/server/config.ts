import { readFileSync } from 'node:fs';

/**
 * Container configuration. One portal container serves exactly one tenant;
 * the tenant binding comes from here and never from the request.
 *
 * Secrets can be passed directly (`FOO`) or as a file path (`FOO_FILE`), which
 * is how Docker / Kubernetes secrets are usually mounted.
 */

export interface TenantScope {
	/** Stable portal-side tenant identifier, also bound into sessions. */
	id: string;
	name: string;
	/** Kibana space that holds this customer's rules and alerts. */
	spaceId: string;
	/** Fleet agent policies that belong to this customer. Must be non-empty. */
	agentPolicyIds: string[];
	/**
	 * Fleet/data-stream namespaces used by this customer's policies. Endpoint
	 * alerts are additionally filtered on `data_stream.namespace` so that a
	 * space-wide Endpoint Security rule cannot leak other customers' alerts.
	 */
	namespaces: string[];
	/** Alerts-as-data alias for the space. */
	alertsIndex: string;
}

export interface ElasticConfig {
	elasticsearchUrl: string;
	kibanaUrl: string;
	/** Tenant-specific, read-only API key (base64 `id:api_key` encoded form). */
	apiKey: string;
	requestTimeoutMs: number;
}

interface AuthConfig {
	sessionSecret: string;
	sessionTtlSeconds: number;
	/** username -> scrypt hash (see scripts/hash-password.mjs) */
	users: Map<string, string>;
	secureCookies: boolean;
	/**
	 * Public origins of this container (e.g. https://portal.acme.example); POSTs must
	 * come from one of them. Several are allowed, e.g. an internal and a public hostname.
	 */
	origins: string[];
}

export interface AppConfig {
	tenant: TenantScope;
	dataSource: 'mock' | 'elastic';
	elastic?: ElasticConfig;
	auth: AuthConfig;
}

type Env = Record<string, string | undefined>;

export class ConfigError extends Error {}

function secret(env: Env, name: string): string | undefined {
	const file = env[`${name}_FILE`];
	if (file) return readFileSync(file, 'utf8').trim();
	return env[name]?.trim() || undefined;
}

function required(env: Env, name: string): string {
	const v = secret(env, name);
	if (!v) throw new ConfigError(`${name} (or ${name}_FILE) must be set`);
	return v;
}

function list(value: string | undefined): string[] {
	return (value ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
}

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/;

/** Users: `alice:scrypt$...,bob:scrypt$...` or a JSON file `{ "alice": "scrypt$..." }`. */
function parseUsers(env: Env): Map<string, string> {
	const users = new Map<string, string>();
	const file = env.PORTAL_USERS_FILE;
	if (file) {
		const parsed = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>;
		for (const [u, h] of Object.entries(parsed)) users.set(u, h);
	}
	for (const entry of list(env.PORTAL_USERS)) {
		const i = entry.indexOf(':');
		if (i > 0) users.set(entry.slice(0, i), entry.slice(i + 1));
	}
	for (const [u, h] of users) {
		if (!h.startsWith('scrypt$'))
			throw new ConfigError(`password hash for user "${u}" is not a scrypt hash`);
	}
	return users;
}

export function loadConfig(env: Env = process.env): AppConfig {
	const id = required(env, 'TENANT_ID');
	const spaceId = env.KIBANA_SPACE_ID?.trim() || id;
	if (!ID_RE.test(id)) throw new ConfigError('TENANT_ID must be a lowercase identifier');
	if (!ID_RE.test(spaceId)) throw new ConfigError('KIBANA_SPACE_ID must be a lowercase identifier');

	const agentPolicyIds = list(env.TENANT_AGENT_POLICY_IDS);
	if (agentPolicyIds.length === 0) {
		// Fail closed: without policies we cannot scope agents.
		throw new ConfigError('TENANT_AGENT_POLICY_IDS must list at least one Fleet agent policy');
	}
	const namespaces = list(env.TENANT_NAMESPACES);
	if (namespaces.length === 0) {
		throw new ConfigError('TENANT_NAMESPACES must list at least one data stream namespace');
	}

	const dataSource = (env.DATA_SOURCE ?? 'mock') as AppConfig['dataSource'];
	if (dataSource !== 'mock' && dataSource !== 'elastic') {
		throw new ConfigError('DATA_SOURCE must be "mock" or "elastic"');
	}

	const tenant: TenantScope = {
		id,
		name: env.TENANT_NAME?.trim() || id,
		spaceId,
		agentPolicyIds,
		namespaces,
		alertsIndex: env.ALERTS_INDEX?.trim() || `.alerts-security.alerts-${spaceId}`
	};

	let elastic: ElasticConfig | undefined;
	if (dataSource === 'elastic') {
		elastic = {
			elasticsearchUrl: required(env, 'ELASTICSEARCH_URL').replace(/\/+$/, ''),
			kibanaUrl: required(env, 'KIBANA_URL').replace(/\/+$/, ''),
			apiKey: required(env, 'ELASTIC_API_KEY'),
			requestTimeoutMs: Number(env.ELASTIC_TIMEOUT_MS ?? 10_000)
		};
	}

	const sessionSecret = required(env, 'SESSION_SECRET');
	if (sessionSecret.length < 32)
		throw new ConfigError('SESSION_SECRET must be at least 32 characters');

	return {
		tenant,
		dataSource,
		elastic,
		auth: {
			sessionSecret,
			sessionTtlSeconds: Number(env.SESSION_TTL_SECONDS ?? 8 * 3600),
			users: parseUsers(env),
			secureCookies: env.COOKIE_SECURE !== 'false',
			origins: list(env.ORIGIN).map((o) => o.replace(/\/+$/, ''))
		}
	};
}
