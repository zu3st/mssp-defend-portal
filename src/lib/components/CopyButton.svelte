<script lang="ts">
	import { Check, Copy } from '@lucide/svelte';

	/** Small icon button that copies `value` and briefly confirms with a check mark. */
	let { value, label = 'Copy' }: { value: string; label?: string } = $props();

	let copied = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;

	async function copy() {
		await navigator.clipboard?.writeText(value);
		copied = true;
		clearTimeout(timer);
		timer = setTimeout(() => (copied = false), 1500);
	}
</script>

<button
	type="button"
	class="shrink-0 rounded p-0.5 text-muted hover:bg-surface-2 hover:text-fg"
	title={label}
	aria-label={label}
	onclick={copy}
>
	{#if copied}<Check size={13} class="text-[var(--ok)]" />{:else}<Copy size={13} />{/if}
</button>
