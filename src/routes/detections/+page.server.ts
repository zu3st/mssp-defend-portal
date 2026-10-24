import { app } from '#lib/server/app.ts';
import { parseAlertQuery, requestRange } from '#lib/server/params.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, cookies }) => {
	const { portal } = app();
	const timeRange = requestRange(url, cookies);
	const query = parseAlertQuery(url.searchParams, Date.now(), timeRange);
	const [alerts, facets] = await Promise.all([
		portal.alerts(query),
		portal.alertFacets(query.range)
	]);
	return { alerts, facets, query, timeRange };
};
