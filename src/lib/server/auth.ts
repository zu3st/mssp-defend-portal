import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Sessions: a stateless HMAC-signed cookie, issued after sign-in at the tenant's
 * identity provider (see oidc.ts). The session is bound to the container's
 * tenant id, so a cookie minted by another tenant's portal is rejected even if
 * both were (mis)configured with the same secret.
 */

export const SESSION_COOKIE = 'portal_session';

export interface Session {
	user: string;
	tenant: string;
	exp: number; // epoch seconds
}

/** What a signed value is for, so one kind of cookie is never accepted as another. */
type Purpose = 'session' | 'login';

function sign(purpose: Purpose, payload: string, secret: string): string {
	return createHmac('sha256', secret).update(`${purpose}.${payload}`).digest('base64url');
}

/** JSON value with an `exp` (epoch seconds). */
export function seal<T extends { exp: number }>(
	purpose: Purpose,
	value: T,
	secret: string
): string {
	const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
	return `${payload}.${sign(purpose, payload, secret)}`;
}

/** The sealed value if the signature and purpose match and it has not expired. */
export function unseal(
	purpose: Purpose,
	token: string | undefined,
	secret: string,
	now = Date.now()
): Record<string, unknown> | null {
	if (!token) return null;
	const [payload, sig] = token.split('.');
	if (!payload || !sig) return null;
	const expected = Buffer.from(sign(purpose, payload, secret));
	const given = Buffer.from(sig);
	if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
	try {
		const v = JSON.parse(Buffer.from(payload, 'base64url').toString());
		if (!v || typeof v !== 'object' || typeof v.exp !== 'number') return null;
		return v.exp * 1000 < now ? null : v;
	} catch {
		return null;
	}
}

export function encodeSession(s: Session, secret: string): string {
	return seal('session', s, secret);
}

export function decodeSession(
	token: string | undefined,
	secret: string,
	tenantId: string,
	now = Date.now()
): Session | null {
	const s = unseal('session', token, secret, now);
	if (!s || typeof s.user !== 'string' || s.tenant !== tenantId) return null;
	return s as unknown as Session;
}

/** CSRF: the Origin header must match one of this container's configured public origins. */
export function isSameOrigin(request: Request, origins: string[]): boolean {
	const given = request.headers.get('origin');
	return given !== null && origins.includes(given);
}

/** Only same-site relative paths are accepted as post-login targets. */
export function safeNext(v: string | null | undefined): string {
	return v && v.startsWith('/') && !v.startsWith('//') && !v.startsWith('/\\') ? v : '/';
}
