import { readFileSync } from 'node:fs';

/**
 * Container configuration, including the one tenant this container serves.
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

/** This tenant's OpenID Connect provider and the portal's client registration there. */
export interface OidcConfig {
	issuer: URL;
	clientId: string;
	clientSecret: string;
	/** Group a user must be in, as named in the ID token's `groups` claim. */
	requiredGroup: string;
}

interface AuthConfig {
	sessionSecret: string;
	sessionTtlSeconds: number;
	secureCookies: boolean;
	/**
	 * Public origins of this container (e.g. https://portal.acme.example). POSTs must
	 * come from one of them, and each has a sign-in callback at `<origin>/auth/callback`.
	 * Several are allowed, e.g. an internal and a public hostname.
	 */
	origins: string[];
	oidc: OidcConfig;
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

/** A whole number setting. A typo stops the container at startup. */
function wholeNumber(env: Env, name: string, fallback: number, min: number): number {
	const raw = env[name]?.trim();
	if (!raw) return fallback;
	if (!/^\d+$/.test(raw) || Number(raw) < min)
		throw new ConfigError(`${name} must be a whole number of at least ${min}`);
	return Number(raw);
}

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/;

/** `https://host[:port]`, without a path. */
function origins(env: Env): string[] {
	const values = list(env.ORIGIN).map((o) => o.replace(/\/+$/, ''));
	if (!values.length) throw new ConfigError('ORIGIN must be set');
	for (const o of values) {
		if (!URL.canParse(o) || new URL(o).origin !== o)
			throw new ConfigError(`ORIGIN "${o}" must be a scheme and host, e.g. https://portal.example`);
	}
	return values;
}

function oidc(env: Env): OidcConfig {
	const issuer = required(env, 'OIDC_ISSUER');
	if (!URL.canParse(issuer) || new URL(issuer).protocol !== 'https:')
		throw new ConfigError('OIDC_ISSUER must be an https URL');
	return {
		issuer: new URL(issuer),
		clientId: required(env, 'OIDC_CLIENT_ID'),
		clientSecret: required(env, 'OIDC_CLIENT_SECRET'),
		requiredGroup: required(env, 'OIDC_REQUIRED_GROUP')
	};
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
			requestTimeoutMs: wholeNumber(env, 'ELASTIC_TIMEOUT_MS', 10_000, 100)
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
			sessionTtlSeconds: wholeNumber(env, 'SESSION_TTL_SECONDS', 8 * 3600, 60),
			secureCookies: env.COOKIE_SECURE !== 'false',
			origins: origins(env),
			oidc: oidc(env)
		}
	};
}
