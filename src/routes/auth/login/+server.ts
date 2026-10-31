import { redirect } from '@sveltejs/kit';
import { app } from '#lib/server/app.ts';
import { safeNext } from '#lib/server/auth.ts';
import {
	beginLogin,
	LOGIN_COOKIE,
	LOGIN_TTL_SECONDS,
	LoginFailure,
	redirectUri
} from '#lib/server/oidc.ts';
import type { RequestHandler } from './$types';

/** Sends the browser to the tenant's identity provider. */
export const GET: RequestHandler = async ({ url, cookies }) => {
	const { config } = app();
	const next = safeNext(url.searchParams.get('next'));
	let target: URL;
	try {
		const login = await beginLogin(
			config.auth.oidc,
			redirectUri(url, config.auth.origins),
			next,
			config.auth.sessionSecret
		);
		cookies.set(LOGIN_COOKIE, login.cookie, {
			path: '/auth',
			httpOnly: true,
			sameSite: 'lax',
			secure: config.auth.secureCookies,
			maxAge: LOGIN_TTL_SECONDS
		});
		target = login.url;
	} catch (e) {
		if (!(e instanceof LoginFailure)) throw e;
		console.error(
			JSON.stringify({ level: 'error', msg: 'sign-in unavailable', detail: e.message })
		);
		redirect(303, `/login?error=${e.reason}`);
	}
	// The provider's own authorization endpoint, from its discovery document.
	redirect(303, target, { external: true });
};
