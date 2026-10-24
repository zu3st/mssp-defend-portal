import { error, json } from '@sveltejs/kit';
import { app } from '#lib/server/app.ts';
import type { RequestHandler } from './$types';

/** Normalized alert detail for the side panel. Auth is enforced in hooks. */
export const GET: RequestHandler = async ({ params }) => {
	const detail = await app().portal.alert(params.id);
	// Foreign and non-existent alerts are indistinguishable.
	if (!detail) error(404, 'Not found');
	return json(detail, { headers: { 'cache-control': 'no-store' } });
};
