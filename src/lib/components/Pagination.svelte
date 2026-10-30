<script lang="ts">
	import { goto } from '$app/navigation';
	import { page as pageState } from '$app/state';
	import { withParams } from '#lib/ui.ts';
	import { num, t } from '#lib/i18n/index.svelte.ts';
	import { ChevronLeft, ChevronRight } from '@lucide/svelte';

	let {
		page,
		pageSize,
		total,
		lowerBound = false,
		noun
	}: {
		page: number;
		pageSize: number;
		total: number;
		lowerBound?: boolean;
		/** Plural of what is counted, e.g. "detections". */
		noun: string;
	} = $props();

	const pages = $derived(Math.max(1, Math.ceil(total / pageSize)));
	const first = $derived(total === 0 ? 0 : (page - 1) * pageSize + 1);
	const last = $derived(Math.min(total, page * pageSize));
	const link = (p: number) => withParams(pageState.url, { page: String(p) });
</script>

<div
	class="flex flex-wrap items-center justify-between gap-3 border-t border-line px-3 py-2 text-[13px] text-muted"
>
	<div>
		{#if total === 0}
			{t().pagination.none(noun)}
		{:else}
			{t().pagination.shown(num(first), num(last), num(total) + (lowerBound ? '+' : ''), noun)}
		{/if}
	</div>
	<!-- Hidden (not removed) when empty, so the bar keeps its height. -->
	<div class="flex items-center gap-2" class:invisible={total === 0}>
		<label class="flex items-center gap-1.5">
			{t().pagination.rows}
			<select
				class="input h-7 px-1.5"
				value={String(pageSize)}
				onchange={(e) => {
					goto(withParams(pageState.url, { size: e.currentTarget.value }), { reset: false });
				}}
			>
				{#each [10, 25, 50, 100] as s (s)}<option value={String(s)}>{s}</option>{/each}
			</select>
		</label>
		<span>{t().pagination.page(page, pages)}</span>
		{#if page > 1}
			<a
				class="btn h-7 px-2"
				href={link(page - 1)}
				aria-label={t().pagination.previous}
				data-sveltekit-reset="false"><ChevronLeft size={14} /></a
			>
		{:else}
			<span class="btn h-7 px-2 opacity-40" aria-hidden="true"><ChevronLeft size={14} /></span>
		{/if}
		{#if page < pages}
			<a
				class="btn h-7 px-2"
				href={link(page + 1)}
				aria-label={t().pagination.next}
				data-sveltekit-reset="false"><ChevronRight size={14} /></a
			>
		{:else}
			<span class="btn h-7 px-2 opacity-40" aria-hidden="true"><ChevronRight size={14} /></span>
		{/if}
	</div>
</div>
