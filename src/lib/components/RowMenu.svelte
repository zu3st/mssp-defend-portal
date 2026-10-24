<script lang="ts" module>
	export interface RowAction {
		label: string;
		href?: string;
		onclick?: () => void;
	}
</script>

<script lang="ts">
	import { closeOnOutsideClick } from '#lib/actions.ts';
	import { Ellipsis } from '@lucide/svelte';

	/** "⋯" menu at the end of a table row. Clicks never reach the row itself. */
	let { actions, label = 'Row actions' }: { actions: RowAction[]; label?: string } = $props();

	let el: HTMLDetailsElement | undefined = $state();
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<details
	class="relative"
	bind:this={el}
	use:closeOnOutsideClick
	onclick={(e) => e.stopPropagation()}
>
	<summary
		class="flex h-7 w-7 cursor-pointer list-none items-center justify-center rounded text-muted hover:bg-surface-2 hover:text-fg"
		aria-label={label}
	>
		<Ellipsis size={16} />
	</summary>
	<div class="card absolute right-0 z-20 mt-1 min-w-44 p-1 shadow-lg">
		{#each actions as a (a.label)}
			{#if a.href}
				<a class="block rounded px-2.5 py-1.5 hover:bg-surface-2" href={a.href}>{a.label}</a>
			{:else}
				<button
					type="button"
					class="block w-full rounded px-2.5 py-1.5 text-left hover:bg-surface-2"
					onclick={() => {
						a.onclick?.();
						if (el) el.open = false;
					}}>{a.label}</button
				>
			{/if}
		{/each}
	</div>
</details>
