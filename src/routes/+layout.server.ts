import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => ({
	user: locals.user ?? null,
	tenantName: locals.tenantName,
	locale: locals.locale,
	localePref: locals.localePref
});
