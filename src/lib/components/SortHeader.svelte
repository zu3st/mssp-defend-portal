<script lang="ts">
	import { page } from '$app/state';
	import { withParams } from '#lib/ui.ts';
	import { ArrowDown, ArrowUp, ArrowUpDown } from '@lucide/svelte';

	let {
		field,
		label,
		sort,
		dir,
		defaultDir = 'asc'
	}: {
		field: string;
		label: string;
		sort: string;
		dir: 'asc' | 'desc';
		defaultDir?: 'asc' | 'desc';
	} = $props();

	const active = $derived(sort === field);
	const next = $derived(active ? (dir === 'asc' ? 'desc' : 'asc') : defaultDir);
</script>

<a
	href={withParams(page.url, { sort: field, dir: next })}
	class="inline-flex items-center gap-1 hover:text-fg"
	class:text-fg={active}
	data-sveltekit-reset="false"
>
	{label}
	{#if active && dir === 'asc'}<ArrowUp size={12} />{:else if active}<ArrowDown
			size={12}
		/>{:else}<ArrowUpDown size={12} class="opacity-40" />{/if}
</a>
