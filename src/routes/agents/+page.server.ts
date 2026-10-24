import { app } from '#lib/server/app.ts';
import { parseAgentQuery } from '#lib/server/params.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const { portal } = app();
	const query = parseAgentQuery(url.searchParams);
	const [agents, facets] = await Promise.all([portal.agentList(query), portal.agentFacets()]);
	return { agents, facets, query };
};
