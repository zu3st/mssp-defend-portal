import { describe, expect, it } from 'vitest';
import {
	decodeSession,
	encodeSession,
	hashPassword,
	isSameOrigin,
	LoginRateLimiter,
	verifyPassword
} from './auth';

const SECRET = 'x'.repeat(40);

describe('passwords', () => {
	it('verifies scrypt hashes', () => {
		const h = hashPassword('correct horse battery');
		expect(verifyPassword('correct horse battery', h)).toBe(true);
		expect(verifyPassword('wrong', h)).toBe(false);
		expect(verifyPassword('anything', undefined)).toBe(false);
	});
});

describe('sessions', () => {
	const exp = Math.floor(Date.now() / 1000) + 60;

	it('round-trips for the bound tenant', () => {
		const t = encodeSession({ user: 'alice', tenant: 'acme', exp }, SECRET);
		expect(decodeSession(t, SECRET, 'acme')).toEqual({ user: 'alice', tenant: 'acme', exp });
	});

	it("rejects another tenant's cookie even with the same secret", () => {
		const t = encodeSession({ user: 'alice', tenant: 'globex', exp }, SECRET);
		expect(decodeSession(t, SECRET, 'acme')).toBeNull();
	});

	it('rejects tampered payloads, wrong secrets and expired sessions', () => {
		const t = encodeSession({ user: 'alice', tenant: 'acme', exp }, SECRET);
		const forged =
			Buffer.from(JSON.stringify({ user: 'admin', tenant: 'acme', exp })).toString('base64url') +
			'.' +
			t.split('.')[1];
		expect(decodeSession(forged, SECRET, 'acme')).toBeNull();
		expect(decodeSession(t, 'y'.repeat(40), 'acme')).toBeNull();
		expect(
			decodeSession(encodeSession({ user: 'a', tenant: 'acme', exp: 1 }, SECRET), SECRET, 'acme')
		).toBeNull();
		expect(decodeSession('garbage', SECRET, 'acme')).toBeNull();
	});
});

describe('login rate limiter', () => {
	it('blocks after max failures within the window', () => {
		const l = new LoginRateLimiter(3, 1000);
		for (let i = 0; i < 3; i++) l.fail('k', 0);
		expect(l.allow('k', 10)).toBe(false);
		expect(l.allow('k', 2000)).toBe(true);
	});
});

describe('same-origin check for POST', () => {
	const req = (h: Record<string, string>) =>
		new Request('http://x/login', { method: 'POST', headers: h });
	it('requires the configured origin', () => {
		expect(isSameOrigin(req({ origin: 'http://localhost:3101' }), ['http://localhost:3101'])).toBe(
			true
		);
		expect(isSameOrigin(req({ origin: 'http://localhost:3102' }), ['http://localhost:3101'])).toBe(
			false
		);
		expect(isSameOrigin(req({}), ['http://localhost:3101'])).toBe(false);
	});
	it('accepts any of several configured origins', () => {
		const origins = ['http://localhost:3101', 'https://portal.acme.example'];
		expect(isSameOrigin(req({ origin: 'https://portal.acme.example' }), origins)).toBe(true);
		expect(isSameOrigin(req({ origin: 'https://evil.example' }), origins)).toBe(false);
	});
	it('falls back to Sec-Fetch-Site without ORIGIN', () => {
		expect(isSameOrigin(req({ 'sec-fetch-site': 'same-origin' }), [])).toBe(true);
		expect(isSameOrigin(req({ 'sec-fetch-site': 'cross-site', origin: 'http://evil' }), [])).toBe(
			false
		);
	});
});
