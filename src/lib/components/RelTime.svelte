<script lang="ts">
	import { formatDate, relativeTime } from '#lib/ui.ts';

	let { iso, absolute = false }: { iso: string | undefined; absolute?: boolean } = $props();
</script>

{#if iso}
	<time datetime={iso} title={formatDate(iso, true)} class="whitespace-nowrap">
		{absolute ? formatDate(iso) : relativeTime(iso)}
	</time>
{:else}
	<span class="text-muted">—</span>
{/if}
