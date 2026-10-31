import { redirect } from '@sveltejs/kit';
import { app } from '#lib/server/app.ts';
import { encodeSession, SESSION_COOKIE } from '#lib/server/auth.ts';
import { completeLogin, LOGIN_COOKIE, LoginFailure, redirectUri } from '#lib/server/oidc.ts';
import type { RequestHandler } from './$types';

/** The identity provider returns here; a valid answer starts a portal session. */
export const GET: RequestHandler = async ({ url, cookies }) => {
	const { config } = app();
	const pending = cookies.get(LOGIN_COOKIE);
	cookies.delete(LOGIN_COOKIE, { path: '/auth' });
	let done: { user: string; next: string };
	try {
		done = await completeLogin(
			config.auth.oidc,
			redirectUri(url, config.auth.origins),
			url,
			pending,
			config.auth.sessionSecret
		);
	} catch (e) {
		if (!(e instanceof LoginFailure)) throw e;
		console.warn(JSON.stringify({ level: 'warn', msg: 'login failed', detail: e.message }));
		redirect(303, `/login?error=${e.reason}`);
	}

	const exp = Math.floor(Date.now() / 1000) + config.auth.sessionTtlSeconds;
	cookies.set(
		SESSION_COOKIE,
		encodeSession({ user: done.user, tenant: config.tenant.id, exp }, config.auth.sessionSecret),
		{
			path: '/',
			httpOnly: true,
			// Lax, so the cookie is sent on the redirect that follows the provider's callback.
			sameSite: 'lax',
			secure: config.auth.secureCookies,
			maxAge: config.auth.sessionTtlSeconds
		}
	);
	console.info(JSON.stringify({ level: 'info', msg: 'login', user: done.user }));
	redirect(303, done.next);
};
