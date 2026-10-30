<script lang="ts" module>
	export interface KV {
		label: string;
		value: string | number | boolean | undefined | null;
		mono?: boolean;
		/** Show "Not available" instead of hiding the row when missing. */
		expected?: boolean;
		/** Identifier / hash: full value on one unbroken line, with a copy button. */
		id?: boolean;
	}
</script>

<script lang="ts">
	import CopyButton from './CopyButton.svelte';
	import { num, t } from '#lib/i18n/index.svelte.ts';

	let { items, title }: { items: KV[]; title?: string } = $props();

	const rows = $derived(
		items.filter((i) => (i.value !== undefined && i.value !== null && i.value !== '') || i.expected)
	);
	const fmt = (v: KV['value']) =>
		typeof v === 'boolean'
			? v
				? t().common.yes
				: t().common.no
			: typeof v === 'number'
				? num(v)
				: v;
</script>

{#if rows.length}
	<section class="space-y-1.5">
		{#if title}<h3 class="text-[11px] font-semibold tracking-wide text-muted uppercase">
				{title}
			</h3>{/if}
		<dl class="grid grid-cols-[minmax(7rem,auto)_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[13px]">
			{#each rows as r (r.label)}
				<dt class="text-muted">{r.label}</dt>
				<dd class={['min-w-0', !r.id && 'break-words', (r.mono || r.id) && 'mono']}>
					{#if r.value === undefined || r.value === null || r.value === ''}
						<span class="text-muted italic">{t().common.notAvailable}</span>
					{:else if r.id}
						{@const v = String(r.value)}
						<span class="flex max-w-full items-center gap-1.5">
							<!-- Never break a hash mid-string; scroll only on very narrow screens. -->
							<span class="min-w-0 overflow-x-auto whitespace-nowrap">{v}</span>
							<CopyButton value={v} label={t().common.copyThing(r.label)} />
						</span>
					{:else}
						{fmt(r.value)}
					{/if}
				</dd>
			{/each}
		</dl>
	</section>
{/if}
