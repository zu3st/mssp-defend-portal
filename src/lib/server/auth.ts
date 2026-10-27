import { createHmac, randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
	password: string,
	salt: Buffer,
	keyLen: number,
	options: { N: number; r: number; p: number }
) => Promise<Buffer>;

/**
 * Lab authentication: local users with scrypt password hashes and a stateless
 * HMAC-signed session cookie. The session is bound to the container's tenant
 * id, so a cookie minted by another tenant's portal is rejected even if both
 * were (mis)configured with the same secret.
 *
 * Production: replace `verifyPassword` + login with OIDC/SAML at a reverse
 * proxy or in-app; keep `Session` and the tenant binding as-is.
 */

export const SESSION_COOKIE = 'portal_session';

export interface Session {
	user: string;
	tenant: string;
	exp: number; // epoch seconds
}

const SCRYPT = { N: 16384, r: 8, p: 1, keyLen: 32 };

export function hashPassword(password: string): string {
	const salt = randomBytes(16);
	const hash = scryptSync(password, salt, SCRYPT.keyLen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
	return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

// Used to equalize timing when the user does not exist.
const DUMMY_HASH = hashPassword(randomBytes(16).toString('hex'));

/** Async so a password check does not block other requests while it runs. */
export async function verifyPassword(
	password: string,
	stored: string | undefined
): Promise<boolean> {
	const [scheme, n, r, p, salt, hash] = (stored ?? DUMMY_HASH).split('$');
	if (scheme !== 'scrypt' || !salt || !hash) return false;
	const expected = Buffer.from(hash, 'base64url');
	const actual = await scryptAsync(password, Buffer.from(salt, 'base64url'), expected.length, {
		N: Number(n),
		r: Number(r),
		p: Number(p)
	});
	return timingSafeEqual(actual, expected) && stored !== undefined;
}

function sign(payload: string, secret: string): string {
	return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function encodeSession(s: Session, secret: string): string {
	const payload = Buffer.from(JSON.stringify(s)).toString('base64url');
	return `${payload}.${sign(payload, secret)}`;
}

export function decodeSession(
	token: string | undefined,
	secret: string,
	tenantId: string,
	now = Date.now()
): Session | null {
	if (!token) return null;
	const [payload, sig] = token.split('.');
	if (!payload || !sig) return null;
	const expected = Buffer.from(sign(payload, secret));
	const given = Buffer.from(sig);
	if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
	try {
		const s = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Session;
		if (typeof s.user !== 'string' || typeof s.exp !== 'number') return null;
		if (s.tenant !== tenantId) return null;
		if (s.exp * 1000 < now) return null;
		return s;
	} catch {
		return null;
	}
}

/** CSRF: the Origin header must match one of this container's configured public origins. */
export function isSameOrigin(request: Request, origins: string[]): boolean {
	const given = request.headers.get('origin');
	if (origins.length) return given !== null && origins.includes(given);
	// No ORIGIN configured: fall back to the browser's own same-origin signal.
	return request.headers.get('sec-fetch-site') === 'same-origin';
}

/**
 * In-memory login throttle (per container): failed logins per client IP within a
 * window, and a cap on password checks running at once. Accounts are never locked.
 */
export class LoginRateLimiter {
	private attempts = new Map<string, { count: number; first: number }>();
	private running = 0;
	constructor(
		private max = 20,
		private windowMs = 60_000,
		private maxConcurrent = 4
	) {}

	allow(ip: string, now = Date.now()): boolean {
		const a = this.attempts.get(ip);
		if (!a || now - a.first > this.windowMs) return true;
		return a.count < this.max;
	}

	fail(ip: string, now = Date.now()) {
		const a = this.attempts.get(ip);
		if (!a || now - a.first > this.windowMs) this.attempts.set(ip, { count: 1, first: now });
		else a.count++;
		if (this.attempts.size > 10_000) {
			for (const [k, v] of this.attempts)
				if (now - v.first > this.windowMs) this.attempts.delete(k);
		}
	}

	/** Takes a password-check slot; false when all are busy. Pair with `release`. */
	acquire(): boolean {
		if (this.running >= this.maxConcurrent) return false;
		this.running++;
		return true;
	}

	release() {
		this.running--;
	}
}
