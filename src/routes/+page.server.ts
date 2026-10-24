import { app } from '#lib/server/app.ts';
import { requestRange } from '#lib/server/params.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, cookies }) => {
	const timeRange = requestRange(url, cookies);
	const overview = await app().portal.overview({ from: timeRange.from, to: timeRange.to });
	return { overview, timeRange };
};
