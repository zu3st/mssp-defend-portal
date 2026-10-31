import type { ElasticConfig } from '../config';

/**
 * Minimal read-only HTTP client for Kibana and Elasticsearch.
 *
 * Uses Node's built-in `fetch` instead of `@elastic/elasticsearch`: we need
 * only `_search`, which keeps us independent of client/server major-version
 * coupling and adds no dependency. Every request is checked against an
 * allowlist of read-only endpoints before it is sent.
 *
 * TLS: for a lab CA, set NODE_EXTRA_CA_CERTS=/path/to/ca.crt (Node built-in).
 */

export class ElasticUnavailableError extends Error {
	constructor(
		message: string,
		readonly status?: number
	) {
		super(message);
	}
}

type Target = 'kibana' | 'es';

interface AllowedRoute {
	target: Target;
	method: 'GET' | 'POST';
	pattern: RegExp;
}

const SPACE = '(?:/s/[a-z0-9_-]+)?';

/** POST is allowed only for read-only search APIs that take a body. */
const READ_ONLY_ROUTES: AllowedRoute[] = [
	{ target: 'kibana', method: 'GET', pattern: new RegExp(`^${SPACE}/api/fleet/agents$`) },
	{ target: 'kibana', method: 'GET', pattern: new RegExp(`^${SPACE}/api/fleet/agents/tags$`) },
	{
		target: 'kibana',
		method: 'GET',
		pattern: new RegExp(`^${SPACE}/api/fleet/agents/available_versions$`)
	},
	{
		target: 'kibana',
		method: 'GET',
		pattern: new RegExp(`^${SPACE}/api/fleet/agents/[A-Za-z0-9-]+$`)
	},
	{ target: 'kibana', method: 'GET', pattern: new RegExp(`^${SPACE}/api/fleet/agent_status$`) },
	{ target: 'kibana', method: 'GET', pattern: new RegExp(`^${SPACE}/api/fleet/agent_policies$`) },
	{ target: 'kibana', method: 'GET', pattern: new RegExp(`^${SPACE}/api/endpoint/metadata$`) },
	{
		target: 'kibana',
		method: 'GET',
		pattern: new RegExp(`^${SPACE}/api/detection_engine/rules$`)
	},
	{ target: 'kibana', method: 'GET', pattern: /^\/api\/status$/ },
	{ target: 'es', method: 'POST', pattern: /^\/\.alerts-security\.alerts-[a-z0-9_-]+\/_search$/ }
];

export function isAllowed(target: Target, method: string, path: string): boolean {
	return READ_ONLY_ROUTES.some(
		(r) => r.target === target && r.method === method && r.pattern.test(path)
	);
}

export class ReadOnlyElasticClient {
	constructor(private cfg: ElasticConfig) {}

	async kibanaGet<T>(
		path: string,
		params?: Record<string, string | number | boolean | undefined>
	): Promise<T | null> {
		return this.request<T>('kibana', 'GET', path, params);
	}

	async esSearch<T>(index: string, body: unknown): Promise<T | null> {
		return this.request<T>('es', 'POST', `/${index}/_search`, { ignore_unavailable: true }, body);
	}

	private async request<T>(
		target: Target,
		method: 'GET' | 'POST',
		path: string,
		params?: Record<string, string | number | boolean | undefined>,
		body?: unknown
	): Promise<T | null> {
		if (!isAllowed(target, method, path)) {
			// Only a programming error gets here: refuse to send.
			throw new Error(`Refusing non-allowlisted Elastic request: ${method} ${target}${path}`);
		}
		const base = target === 'kibana' ? this.cfg.kibanaUrl : this.cfg.elasticsearchUrl;
		const url = new URL(base + path);
		for (const [k, v] of Object.entries(params ?? {}))
			if (v !== undefined) url.searchParams.set(k, String(v));

		const headers: Record<string, string> = {
			Authorization: `ApiKey ${this.cfg.apiKey}`,
			Accept: 'application/json'
		};
		if (body !== undefined) headers['Content-Type'] = 'application/json';
		if (target === 'kibana') headers['elastic-api-version'] = '2023-10-31';

		let res: Response;
		try {
			res = await fetch(url, {
				method,
				headers,
				body: body === undefined ? undefined : JSON.stringify(body),
				signal: AbortSignal.timeout(this.cfg.requestTimeoutMs),
				redirect: 'error'
			});
		} catch (e) {
			throw new ElasticUnavailableError(`${target} unreachable: ${(e as Error).message}`);
		}
		if (res.status === 404) {
			// Callers treat 404 as "not found in this tenant".
			return null;
		}
		if (!res.ok) {
			// Do not propagate the body: it may contain internal details.
			throw new ElasticUnavailableError(
				`${target} responded ${res.status} for ${method} ${url.pathname}`,
				res.status
			);
		}
		return (await res.json()) as T;
	}
}
