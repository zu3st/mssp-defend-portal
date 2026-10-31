import * as oauth from 'oauth4webapi';
import { seal, unseal } from './auth';
import type { OidcConfig } from './config';

/**
 * Sign-in at the tenant's OpenID Connect provider: authorization code flow with
 * PKCE, state and nonce. Between the redirect to the provider and its callback,
 * these values wait in a signed, short-lived cookie.
 */

export const LOGIN_COOKIE = 'portal_login';
export const LOGIN_TTL_SECONDS = 600;
export const CALLBACK_PATH = '/auth/callback';
const TIMEOUT_MS = 10_000;

/** Why a sign-in did not complete, as shown on the sign-in page. */
export type LoginError = 'failed' | 'denied' | 'unavailable';

export class LoginFailure extends Error {
	constructor(
		readonly reason: LoginError,
		message: string
	) {
		super(message);
	}
}

/** The callback on the origin the browser used, if it is one of this container's. */
export function redirectUri(url: URL, origins: string[]): string {
	return (origins.includes(url.origin) ? url.origin : origins[0]) + CALLBACK_PATH;
}

interface PendingLogin {
	state: string;
	nonce: string;
	verifier: string;
	next: string;
	exp: number;
}

/** Provider metadata, fetched on first use and kept for the life of the process. */
let discovered: Promise<oauth.AuthorizationServer> | undefined;

function provider(cfg: OidcConfig): Promise<oauth.AuthorizationServer> {
	discovered ??= oauth
		.discoveryRequest(cfg.issuer, { algorithm: 'oidc', signal: AbortSignal.timeout(TIMEOUT_MS) })
		.then((response) => oauth.processDiscoveryResponse(cfg.issuer, response))
		.catch((e) => {
			discovered = undefined;
			throw new LoginFailure('unavailable', `discovery failed: ${(e as Error).message}`);
		});
	return discovered;
}

/** The provider's authorization URL, and the cookie value that the callback checks. */
export async function beginLogin(
	cfg: OidcConfig,
	redirectUri: string,
	next: string,
	secret: string
): Promise<{ url: URL; cookie: string }> {
	const as = await provider(cfg);
	const pending: PendingLogin = {
		state: oauth.generateRandomState(),
		nonce: oauth.generateRandomNonce(),
		verifier: oauth.generateRandomCodeVerifier(),
		next,
		exp: Math.floor(Date.now() / 1000) + LOGIN_TTL_SECONDS
	};
	const url = new URL(as.authorization_endpoint!);
	url.search = new URLSearchParams({
		response_type: 'code',
		client_id: cfg.clientId,
		redirect_uri: redirectUri,
		scope: 'openid profile groups',
		state: pending.state,
		nonce: pending.nonce,
		code_challenge: await oauth.calculatePKCECodeChallenge(pending.verifier),
		code_challenge_method: 'S256'
	}).toString();
	return { url, cookie: seal('login', pending, secret) };
}

/** Redeems the callback's code and returns the signed-in user and where to go next. */
export async function completeLogin(
	cfg: OidcConfig,
	redirectUri: string,
	callback: URL,
	cookie: string | undefined,
	secret: string
): Promise<{ user: string; next: string }> {
	const pending = unseal('login', cookie, secret) as PendingLogin | null;
	if (!pending) throw new LoginFailure('failed', 'no pending sign-in (cookie missing or expired)');

	const as = await provider(cfg);
	const client: oauth.Client = { client_id: cfg.clientId };
	let claims: oauth.IDToken | undefined;
	try {
		const params = oauth.validateAuthResponse(as, client, callback, pending.state);
		const response = await oauth.authorizationCodeGrantRequest(
			as,
			client,
			oauth.ClientSecretPost(cfg.clientSecret),
			params,
			redirectUri,
			pending.verifier,
			{ signal: AbortSignal.timeout(TIMEOUT_MS) }
		);
		const tokens = await oauth.processAuthorizationCodeResponse(as, client, response, {
			expectedNonce: pending.nonce,
			requireIdToken: true
		});
		claims = oauth.getValidatedIdTokenClaims(tokens);
	} catch (e) {
		if (e instanceof oauth.AuthorizationResponseError && e.error === 'access_denied')
			throw new LoginFailure('denied', 'provider denied access');
		throw new LoginFailure('failed', `code exchange failed: ${(e as Error).message}`);
	}
	const user = String(claims?.preferred_username ?? claims?.sub ?? '');
	const groups = Array.isArray(claims?.groups) ? claims.groups : [];
	if (!user) throw new LoginFailure('failed', 'ID token has no user');
	if (!groups.includes(cfg.requiredGroup))
		throw new LoginFailure('denied', `user ${user} is not in ${cfg.requiredGroup}`);
	return { user, next: pending.next };
}
