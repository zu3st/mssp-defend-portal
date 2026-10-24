import { error } from '@sveltejs/kit';
import { app } from '#lib/server/app.ts';
import { parseAlertQuery, requestRange } from '#lib/server/params.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url, cookies }) => {
	const { portal } = app();
	const agent = await portal.agent(params.agentId);
	// Other tenants' agents are indistinguishable from missing ones.
	if (!agent) error(404, 'Agent not found');

	const tab = url.searchParams.get('tab') === 'detections' ? 'detections' : 'details';
	if (tab === 'details') return { agent, tab, alerts: null, query: null, facets: null };

	const timeRange = requestRange(url, cookies);
	const query = {
		...parseAlertQuery(url.searchParams, Date.now(), timeRange),
		agentId: agent.agentId,
		hostname: undefined
	};
	const [alerts, facets] = await Promise.all([
		portal.alerts(query),
		portal.alertFacets(query.range)
	]);
	return { agent, tab, alerts, query, facets, timeRange };
};
