import { describe, expect, it } from 'vitest';
import { decodeSession, encodeSession, isSameOrigin, safeNext, seal, unseal } from './auth';

const SECRET = 'x'.repeat(40);

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

describe('signed values', () => {
	it('are accepted only for the purpose they were signed for', () => {
		const exp = Math.floor(Date.now() / 1000) + 60;
		const login = seal('login', { exp, state: 's' }, SECRET);
		expect(unseal('login', login, SECRET)).toEqual({ exp, state: 's' });
		expect(unseal('session', login, SECRET)).toBeNull();
		expect(decodeSession(login, SECRET, 'acme')).toBeNull();
	});
});

describe('post-login target', () => {
	it('allows only same-site relative paths', () => {
		expect(safeNext('/detections?range=7d')).toBe('/detections?range=7d');
		for (const v of ['https://evil.example', '//evil.example', '/\\evil.example', '', null])
			expect(safeNext(v)).toBe('/');
	});
});

describe('same-origin check for POST', () => {
	const req = (h: Record<string, string>) =>
		new Request('http://x/logout', { method: 'POST', headers: h });
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
});
