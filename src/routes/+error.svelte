<script lang="ts">
	import { page } from '$app/state';

	/** Back to the section the missing page belongs to. */
	const back = $derived(
		page.url.pathname.startsWith('/agents')
			? { href: '/agents', label: 'Back to agents' }
			: page.url.pathname.startsWith('/detections')
				? { href: '/detections', label: 'Back to detections' }
				: { href: '/', label: 'Back to overview' }
	);
</script>

<div class="mx-auto max-w-md py-16 text-center">
	<div class="text-4xl font-semibold text-muted">{page.status}</div>
	<p class="mt-2">{page.error?.message ?? 'Something went wrong.'}</p>
	<a href={back.href} class="btn mt-6">{back.label}</a>
</div>
