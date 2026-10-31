import { generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { seal } from './auth';
import type { OidcConfig } from './config';
import { beginLogin, completeLogin, LoginFailure, redirectUri } from './oidc';

const SECRET = 'x'.repeat(40);
const ISSUER = 'https://idm.acme.example/oauth2/openid/portal-acme';
const REDIRECT = 'https://portal.acme.example/auth/callback';
const CFG: OidcConfig = {
	issuer: new URL(ISSUER),
	clientId: 'portal-acme',
	clientSecret: 'client-secret',
	requiredGroup: 'portal_users@idm.acme.example'
};
const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });

function idToken(claims: Record<string, unknown>): string {
	const b64 = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url');
	const now = Math.floor(Date.now() / 1000);
	const data = `${b64({ alg: 'ES256', typ: 'JWT' })}.${b64({
		iss: ISSUER,
		aud: CFG.clientId,
		sub: '6f1c…',
		preferred_username: 'jane.doe',
		groups: [CFG.requiredGroup],
		iat: now,
		exp: now + 300,
		...claims
	})}`;
	const sig = sign('sha256', Buffer.from(data), { key: privateKey, dsaEncoding: 'ieee-p1363' });
	return `${data}.${sig.toString('base64url')}`;
}

/** A fake provider: discovery and a token endpoint that returns `claims` in the ID token. */
let claims: Record<string, unknown>;
let tokenRequests: URLSearchParams[];

beforeEach(() => {
	claims = {};
	tokenRequests = [];
	vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
		if (url.endsWith('/.well-known/openid-configuration'))
			return Response.json({
				issuer: ISSUER,
				authorization_endpoint: 'https://idm.acme.example/ui/oauth2',
				token_endpoint: 'https://idm.acme.example/oauth2/token',
				id_token_signing_alg_values_supported: ['ES256']
			});
		if (url === 'https://idm.acme.example/oauth2/token') {
			const body = new URLSearchParams(String(init.body));
			tokenRequests.push(body);
			return Response.json({
				access_token: 'at',
				token_type: 'Bearer',
				expires_in: 300,
				id_token: idToken({ ...claims })
			});
		}
		return new Response('not found', { status: 404 });
	});
});
afterEach(() => vi.unstubAllGlobals());

/** Starts a sign-in and returns its cookie plus the callback the provider would send. */
async function started(next = '/detections') {
	const { url, cookie } = await beginLogin(CFG, REDIRECT, next, SECRET);
	const state = url.searchParams.get('state')!;
	claims.nonce = url.searchParams.get('nonce');
	const callback = new URL(`${REDIRECT}?code=the-code&state=${state}`);
	return { url, cookie, callback };
}

const reason = (p: Promise<unknown>) =>
	p.then(
		() => 'ok',
		(e) => (e instanceof LoginFailure ? e.reason : `unexpected: ${e}`)
	);

describe('sign-in', () => {
	it('sends the user to the provider with PKCE, state and nonce', async () => {
		const { url } = await started();
		expect(url.origin + url.pathname).toBe('https://idm.acme.example/ui/oauth2');
		expect(url.searchParams.get('client_id')).toBe('portal-acme');
		expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT);
		expect(url.searchParams.get('code_challenge_method')).toBe('S256');
		expect(url.searchParams.get('scope')).toBe('openid profile groups');
		for (const p of ['state', 'nonce', 'code_challenge'])
			expect(url.searchParams.get(p)?.length).toBeGreaterThan(20);
	});

	it('signs in a member of the required group and returns to the requested page', async () => {
		const { cookie, callback } = await started('/agents?status=offline');
		expect(await completeLogin(CFG, REDIRECT, callback, cookie, SECRET)).toEqual({
			user: 'jane.doe',
			next: '/agents?status=offline'
		});
		expect(tokenRequests[0].get('code')).toBe('the-code');
		expect(tokenRequests[0].get('redirect_uri')).toBe(REDIRECT);
		expect(tokenRequests[0].get('code_verifier')?.length).toBeGreaterThan(40);
	});

	it('denies users outside the required group', async () => {
		const { cookie, callback } = await started();
		claims.groups = ['other@idm.acme.example'];
		expect(await reason(completeLogin(CFG, REDIRECT, callback, cookie, SECRET))).toBe('denied');
		claims.groups = undefined;
		expect(await reason(completeLogin(CFG, REDIRECT, callback, cookie, SECRET))).toBe('denied');
	});

	it('reports a refusal at the provider as denied', async () => {
		const { cookie, url } = await started();
		const callback = new URL(
			`${REDIRECT}?error=access_denied&state=${url.searchParams.get('state')}`
		);
		expect(await reason(completeLogin(CFG, REDIRECT, callback, cookie, SECRET))).toBe('denied');
		expect(tokenRequests).toHaveLength(0);
	});

	it('rejects a callback that does not belong to the pending sign-in', async () => {
		const { cookie, callback } = await started();
		const forged = new URL(callback);
		forged.searchParams.set('state', 'attacker-state');
		expect(await reason(completeLogin(CFG, REDIRECT, forged, cookie, SECRET))).toBe('failed');
		expect(tokenRequests).toHaveLength(0);
	});

	it('rejects an ID token for another sign-in, client or issuer', async () => {
		for (const bad of [
			{ nonce: 'other-nonce' },
			{ aud: 'portal-globex' },
			{ iss: 'https://idm.globex.example/oauth2/openid/portal-globex' }
		]) {
			const { cookie, callback } = await started();
			Object.assign(claims, bad);
			expect(await reason(completeLogin(CFG, REDIRECT, callback, cookie, SECRET))).toBe('failed');
		}
	});

	it('needs the signed cookie of a pending sign-in', async () => {
		const { cookie, callback } = await started();
		const expired = seal('login', { exp: 1 }, SECRET);
		for (const c of [undefined, 'garbage', expired, cookie.replace(/.$/, 'A')])
			expect(await reason(completeLogin(CFG, REDIRECT, callback, c, SECRET))).toBe('failed');
		expect(await reason(completeLogin(CFG, REDIRECT, callback, cookie, 'y'.repeat(40)))).toBe(
			'failed'
		);
		expect(tokenRequests).toHaveLength(0);
	});
});

describe('callback URL', () => {
	const origins = ['https://portal.acme.example', 'https://acme.internal.example'];
	it('uses the origin the browser came from when it is configured, else the first', () => {
		expect(redirectUri(new URL('https://acme.internal.example/login'), origins)).toBe(
			'https://acme.internal.example/auth/callback'
		);
		expect(redirectUri(new URL('http://10.0.0.5:3000/login'), origins)).toBe(
			'https://portal.acme.example/auth/callback'
		);
	});
});
