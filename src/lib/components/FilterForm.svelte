<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import { Search, X } from '@lucide/svelte';

	/**
	 * GET form that maps filters to URL params. Changing a control submits it
	 * (client-side navigation). The current sort, direction, page size and time
	 * range are carried along automatically (plus any `keep` extras); the page
	 * resets.
	 */
	let {
		search,
		placeholder = 'Search…',
		keep = {},
		clearHref,
		active = false,
		children
	}: {
		search?: string;
		placeholder?: string;
		keep?: Record<string, string | undefined>;
		clearHref: string;
		active?: boolean;
		children?: Snippet;
	} = $props();

	let form: HTMLFormElement | undefined = $state();
	let timer: ReturnType<typeof setTimeout> | undefined;

	const carried = $derived({
		sort: page.url.searchParams.get('sort') ?? undefined,
		dir: page.url.searchParams.get('dir') ?? undefined,
		size: page.url.searchParams.get('size') ?? undefined,
		range: page.url.searchParams.get('range') ?? undefined,
		from: page.url.searchParams.get('from') ?? undefined,
		to: page.url.searchParams.get('to') ?? undefined,
		...keep
	});

	function submitSoon(delay = 0) {
		clearTimeout(timer);
		// Incomplete inputs (e.g. a custom range without dates) wait for the user.
		timer = setTimeout(() => form?.checkValidity() && form.requestSubmit(), delay);
	}
</script>

<form
	method="GET"
	bind:this={form}
	class="flex flex-wrap items-center gap-2"
	data-sveltekit-reset="false"
	onchange={(e) => {
		const t = e.target as HTMLElement;
		if (t.getAttribute('name') !== 'q' && !t.hasAttribute('data-nosubmit')) submitSoon();
	}}
>
	<!-- Search takes whatever width the filters leave free; "Clear" lives inside it
	     so showing it never moves the filter controls. -->
	<div class="relative min-w-64 flex-1">
		<Search
			size={14}
			class="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted"
		/>
		<input
			class={['input w-full pl-8', active && 'pr-20']}
			type="search"
			name="q"
			aria-label="Search"
			value={search ?? ''}
			{placeholder}
			maxlength="64"
			autocomplete="off"
			oninput={() => submitSoon(350)}
		/>
		{#if active}
			<a
				class="absolute top-1/2 right-1.5 inline-flex -translate-y-1/2 items-center gap-1 rounded px-1.5 py-0.5 text-[12px] text-muted hover:bg-surface-2 hover:text-fg"
				href={clearHref}
				data-sveltekit-reset="false"><X size={12} /> Clear</a
			>
		{/if}
	</div>
	{@render children?.()}
	{#each Object.entries(carried) as [k, v] (k)}
		{#if v}<input type="hidden" name={k} value={v} />{/if}
	{/each}
	<noscript><button class="btn btn-primary" type="submit">Apply</button></noscript>
</form>
