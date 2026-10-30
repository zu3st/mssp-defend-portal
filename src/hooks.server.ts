import { redirect } from '@sveltejs/kit';
import type { Handle, HandleServerError } from '@sveltejs/kit/hooks';
import { app } from '#lib/server/app.ts';
import { decodeSession, isSameOrigin, SESSION_COOKIE } from '#lib/server/auth.ts';
import { ElasticUnavailableError } from '#lib/server/elastic/http.ts';
import { ScopeViolationError } from '#lib/server/portal.ts';
import {
	isLocale,
	LOCALE_COOKIE,
	messages,
	negotiate,
	parseAcceptLanguage
} from '#lib/i18n/index.svelte.ts';

const PUBLIC_PATHS = new Set(['/login', '/healthz', '/readyz']);
const THEMES = new Set(['light', 'dark']);

export const handle: Handle = async ({ event, resolve }) => {
	const { config, portal } = app();
	const path = event.url.pathname;

	// Probes: no auth, no tenant information in the body.
	if (path === '/healthz') return new Response('ok', { headers: { 'cache-control': 'no-store' } });
	if (path === '/readyz') {
		try {
			await portal.ping();
			return new Response('ready', { headers: { 'cache-control': 'no-store' } });
		} catch {
			return new Response('elastic unavailable', {
				status: 503,
				headers: { 'cache-control': 'no-store' }
			});
		}
	}

	// Language: the user's choice, else the first one the browser asks for that the portal has.
	const langCookie = event.cookies.get(LOCALE_COOKIE);
	event.locals.locale = isLocale(langCookie)
		? langCookie
		: negotiate(parseAcceptLanguage(event.request.headers.get('accept-language')));

	// The portal is read-only: only the login/logout form actions may POST.
	if (event.request.method !== 'GET' && event.request.method !== 'HEAD') {
		if (!['/login', '/logout'].includes(path))
			return new Response('Method not allowed', { status: 405 });
		if (!isSameOrigin(event.request, config.auth.origins)) {
			return new Response(messages(event.locals.locale).auth.crossSite, { status: 403 });
		}
	}

	const session = decodeSession(
		event.cookies.get(SESSION_COOKIE),
		config.auth.sessionSecret,
		config.tenant.id
	);
	event.locals.user = session?.user;
	event.locals.tenantName = config.tenant.name;

	const isPublic = PUBLIC_PATHS.has(path) || path.startsWith('/_app/') || path === '/favicon.svg';
	if (!session && !isPublic) {
		if (path.startsWith('/api/')) return new Response('Unauthorized', { status: 401 });
		redirect(303, `/login?next=${encodeURIComponent(path + event.url.search)}`);
	}

	const themeCookie = event.cookies.get('theme');
	const theme = themeCookie && THEMES.has(themeCookie) ? themeCookie : '';

	const response = await resolve(event, {
		transformPageChunk: ({ html }) =>
			html.replace('%portal.theme%', theme).replace('%portal.lang%', event.locals.locale)
	});
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'same-origin');
	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
	if (!path.startsWith('/_app/immutable/')) response.headers.set('Cache-Control', 'no-store');
	return response;
};

export const handleError: HandleServerError = ({ kind, error, event }) => {
	// App errors (error(404, ...)) and framework errors keep their own safe messages.
	if (kind !== 'unknown') return;
	const path = event.url.pathname;
	if (error instanceof ScopeViolationError) {
		// Loud server-side, opaque client-side.
		console.error(
			JSON.stringify({ level: 'error', msg: 'TENANT SCOPE VIOLATION', detail: error.message, path })
		);
		return { message: messages(event.locals.locale).errors.internal };
	}
	if (error instanceof ElasticUnavailableError) {
		console.error(
			JSON.stringify({ level: 'error', msg: 'elastic unavailable', detail: error.message, path })
		);
		return {
			status: 503,
			message: messages(event.locals.locale).errors.unavailable
		};
	}
	console.error(
		JSON.stringify({
			level: 'error',
			msg: 'unhandled',
			detail: String((error as Error)?.message ?? error),
			path
		})
	);
	return { message: messages(event.locals.locale).errors.internal };
};
