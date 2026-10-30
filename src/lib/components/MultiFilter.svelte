<script lang="ts">
	import { closeOnOutsideClick } from '#lib/actions.ts';
	import { t } from '#lib/i18n/index.svelte.ts';
	import { ChevronDown, Search } from '@lucide/svelte';

	/**
	 * Checkbox dropdown inside a GET filter form. Uses <details> so it works
	 * without JavaScript; the enclosing form auto-submits on change. The menu
	 * opens right-aligned when it would overflow, and long lists get a filter box.
	 */
	let {
		name,
		label,
		options,
		selected = [],
		freeText = false
	}: {
		name: string;
		label: string;
		options: { value: string; label: string }[];
		selected?: string[];
		/**
		 * Options are free-form values (rule names, tags, policies) that may be
		 * truncated. Fixed enums (severity, status, type) are never truncated:
		 * the button reserves the full width of the longest one.
		 */
		freeText?: boolean;
	} = $props();

	const MENU_WIDTH = 416; // px, matches max-w-[26rem]
	let el: HTMLDetailsElement | undefined = $state();
	let alignRight = $state(false);
	let filter = $state('');
	const searchable = $derived(options.length > 8);
	const needle = $derived(filter.trim().toLowerCase());

	const summary = $derived(
		selected.length === 0
			? t().common.all
			: selected.length === 1
				? (options.find((o) => o.value === selected[0])?.label ?? selected[0])
				: t().common.selected(selected.length)
	);

	const sizers = $derived([
		...new Set([
			t().common.all,
			t().common.selected(Math.max(options.length, 2)),
			...options.map((o) => o.label)
		])
	]);

	function onToggle() {
		if (!el?.open) return;
		const r = el.getBoundingClientRect();
		alignRight = r.left + MENU_WIDTH > document.documentElement.clientWidth - 16;
	}
</script>

<details class="relative" bind:this={el} use:closeOnOutsideClick ontoggle={onToggle}>
	<summary class="btn cursor-pointer list-none" class:text-accent={selected.length > 0}>
		<span class="text-muted">{label}:</span>
		<!-- All possible labels share one grid cell, so the button is as wide as the
		     longest one (capped) and never changes width when the selection changes. -->
		<span class={['grid', freeText && 'max-w-[5.5rem]']} title={summary}>
			{#each sizers as s (s)}
				<span
					class={['invisible col-start-1 row-start-1', freeText ? 'truncate' : 'whitespace-nowrap']}
					aria-hidden="true">{s}</span
				>
			{/each}
			<span class={['col-start-1 row-start-1', freeText ? 'truncate' : 'whitespace-nowrap']}
				>{summary}</span
			>
		</span>
		<ChevronDown size={14} class="opacity-60" />
	</summary>
	<div
		class={[
			'card absolute z-20 mt-1 w-max max-w-[26rem] min-w-56 p-1 shadow-lg',
			alignRight ? 'right-0' : 'left-0'
		]}
	>
		{#if searchable}
			<label class="relative mb-1 block">
				<span class="sr-only">{t().common.filterPlaceholder(label)}</span>
				<Search
					size={13}
					class="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-muted"
				/>
				<!-- Unnamed and data-nosubmit: never sent, never triggers the form. -->
				<input
					class="input h-7 w-full pl-7"
					placeholder={t().common.filterPlaceholder(label)}
					bind:value={filter}
					data-nosubmit
					onkeydown={(e) => e.key === 'Enter' && e.preventDefault()}
				/>
			</label>
		{/if}
		<div class="max-h-72 overflow-auto">
			{#each options as o (o.value)}
				<!-- Filtered-out options stay in the DOM so their checked state is still submitted. -->
				<label
					class="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-surface-2"
					class:hidden={needle !== '' && !o.label.toLowerCase().includes(needle)}
					title={o.label}
				>
					<input
						type="checkbox"
						{name}
						value={o.value}
						checked={selected.includes(o.value)}
						class="shrink-0 accent-[var(--accent)]"
					/>
					<span class={freeText ? 'truncate' : 'whitespace-nowrap'}>{o.label}</span>
				</label>
			{:else}
				<div class="px-2 py-1.5 text-muted">{t().common.noValues}</div>
			{/each}
		</div>
	</div>
</details>
