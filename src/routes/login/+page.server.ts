import { fail, redirect } from '@sveltejs/kit';
import { app } from '#lib/server/app.ts';
import { encodeSession, SESSION_COOKIE, verifyPassword } from '#lib/server/auth.ts';
import { messages } from '#lib/i18n/index.svelte.ts';
import type { Actions, PageServerLoad } from './$types';

/** Only same-site relative paths are accepted as post-login targets. */
function safeNext(v: string | null): string {
	return v && v.startsWith('/') && !v.startsWith('//') && !v.startsWith('/\\') ? v : '/';
}

export const load: PageServerLoad = ({ locals, url }) => {
	if (locals.user) redirect(303, safeNext(url.searchParams.get('next')));
	return {};
};

export const actions: Actions = {
	default: async ({ request, cookies, url, getClientAddress, locals }) => {
		const { config, limiter } = app();
		const text = messages(locals.locale).auth;
		const form = await request.formData();
		const username = String(form.get('username') ?? '')
			.trim()
			.slice(0, 100);
		const password = String(form.get('password') ?? '').slice(0, 256);
		const ip = getClientAddress();

		if (!limiter.allow(ip) || !limiter.acquire()) {
			return fail(429, {
				username,
				message: text.tooMany
			});
		}
		let ok: boolean;
		try {
			ok =
				!!username &&
				!!password &&
				(await verifyPassword(password, config.auth.users.get(username)));
		} finally {
			limiter.release();
		}
		if (!ok) {
			limiter.fail(ip);
			console.warn(JSON.stringify({ level: 'warn', msg: 'login failed', user: username }));
			return fail(400, { username, message: text.invalid });
		}

		const exp = Math.floor(Date.now() / 1000) + config.auth.sessionTtlSeconds;
		cookies.set(
			SESSION_COOKIE,
			encodeSession({ user: username, tenant: config.tenant.id, exp }, config.auth.sessionSecret),
			{
				path: '/',
				httpOnly: true,
				sameSite: 'strict',
				secure: config.auth.secureCookies,
				maxAge: config.auth.sessionTtlSeconds
			}
		);
		console.info(JSON.stringify({ level: 'info', msg: 'login', user: username }));
		redirect(303, safeNext(url.searchParams.get('next')));
	}
};
