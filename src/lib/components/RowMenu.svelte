<script lang="ts" module>
	export interface RowAction {
		label: string;
		href?: string;
		onclick?: () => void;
	}
</script>

<script lang="ts">
	import { closeOnOutsideClick } from '#lib/actions.ts';
	import { t } from '#lib/i18n/index.svelte.ts';
	import { Ellipsis } from '@lucide/svelte';

	/** "⋯" menu at the end of a table row. Clicks never reach the row itself. */
	let { actions, label = t().common.rowActions }: { actions: RowAction[]; label?: string } =
		$props();

	let el: HTMLDetailsElement | undefined = $state();
	let menu: HTMLDivElement | undefined = $state();
	let pos = $state('');

	// Fixed, not absolute: a table wrapper with overflow would clip the menu.
	// Opens below the button, or above it when there is no room below.
	function place() {
		if (!el?.open || !menu) return void (pos = '');
		const r = el.querySelector('summary')!.getBoundingClientRect();
		const right = `right: ${window.innerWidth - r.right}px;`;
		pos =
			window.innerHeight - r.bottom < menu.offsetHeight + 8
				? `${right} bottom: ${window.innerHeight - r.top + 4}px;`
				: `${right} top: ${r.bottom + 4}px;`;
	}

	function close() {
		if (el) el.open = false;
	}
</script>

<!-- Capture: also closes when a scrolling container (the table) moves the button. -->
<svelte:window onscrollcapture={close} onresize={close} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<details
	class="relative"
	bind:this={el}
	use:closeOnOutsideClick
	onclick={(e) => e.stopPropagation()}
	ontoggle={place}
>
	<summary
		class="flex h-7 w-7 cursor-pointer list-none items-center justify-center rounded text-muted hover:bg-surface-2 hover:text-fg"
		aria-label={label}
	>
		<Ellipsis size={16} />
	</summary>
	<div
		class={['card fixed z-20 min-w-44 p-1 shadow-lg', !pos && 'invisible']}
		style={pos}
		bind:this={menu}
	>
		{#each actions as a (a.label)}
			{#if a.href}
				<a class="block rounded px-2.5 py-1.5 hover:bg-surface-2" href={a.href}>{a.label}</a>
			{:else}
				<button
					type="button"
					class="block w-full rounded px-2.5 py-1.5 text-left hover:bg-surface-2"
					onclick={() => {
						a.onclick?.();
						close();
					}}>{a.label}</button
				>
			{/if}
		{/each}
	</div>
</details>
