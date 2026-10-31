import { redirect } from '@sveltejs/kit';
import { safeNext } from '#lib/server/auth.ts';
import type { LoginError } from '#lib/server/oidc.ts';
import type { PageServerLoad } from './$types';

const ERRORS: LoginError[] = ['failed', 'denied', 'unavailable'];

export const load: PageServerLoad = ({ locals, url }) => {
	const next = safeNext(url.searchParams.get('next'));
	if (locals.user) redirect(303, next);
	const error = url.searchParams.get('error');
	return {
		next,
		error: ERRORS.find((e) => e === error) ?? null
	};
};
