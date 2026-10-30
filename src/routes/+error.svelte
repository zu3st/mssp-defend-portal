<script lang="ts">
	import { page } from '$app/state';
	import { t } from '#lib/i18n/index.svelte.ts';

	/** Back to the section the missing page belongs to. */
	const back = $derived(
		page.url.pathname.startsWith('/agents')
			? { href: '/agents', label: t().errors.backToAgents }
			: page.url.pathname.startsWith('/detections')
				? { href: '/detections', label: t().errors.backToDetections }
				: { href: '/', label: t().errors.backToOverview }
	);
	/** SvelteKit's own 404 for unknown paths has an English message; the portal's are localized. */
	const message = $derived(
		page.status === 404 && page.error?.message === 'Not Found'
			? t().errors.notFound
			: (page.error?.message ?? t().errors.generic)
	);
</script>

<div class="mx-auto max-w-md py-16 text-center">
	<div class="text-4xl font-semibold text-muted">{page.status}</div>
	<p class="mt-2">{message}</p>
	<a href={back.href} class="btn mt-6">{back.label}</a>
</div>
