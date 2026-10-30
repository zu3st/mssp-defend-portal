<script lang="ts">
	import type { AlertSummary } from '#lib/contract.ts';
	import { closingReasonLabel, kindLabel } from '#lib/ui.ts';
	import StatusBadge from '../StatusBadges.svelte';
	import SortHeader from '../SortHeader.svelte';
	import RelTime from '../RelTime.svelte';
	import RowMenu from '../RowMenu.svelte';
	import { t } from '#lib/i18n/index.svelte.ts';

	let {
		items,
		selected,
		onselect,
		sort,
		dir,
		showHost = true,
		sortable = true,
		clearHref,
		emptyText = t().detections.noMatch
	}: {
		items: AlertSummary[];
		selected: string | null;
		onselect: (id: string) => void;
		sort?: string;
		dir?: 'asc' | 'desc';
		showHost?: boolean;
		sortable?: boolean;
		/** Shown as "Clear filters" in the empty state when filters are active. */
		clearHref?: string;
		emptyText?: string;
	} = $props();
</script>

{#snippet head(field: string, label: string, defaultDir: 'asc' | 'desc' = 'asc')}
	{#if sortable && sort && dir}<SortHeader
			{field}
			{label}
			{sort}
			{dir}
			{defaultDir}
		/>{:else}{label}{/if}
{/snippet}

<!-- Fixed layout: column widths never depend on the rows currently shown. -->
<div class="overflow-x-auto">
	<table class="data-table compact min-w-[66rem] table-fixed">
		<colgroup>
			<col class="w-32" />
			<col class="w-24" />
			<col />
			{#if showHost}<col class="w-44 2xl:w-60" />{/if}
			<col class="w-28" />
			<col class="w-32" />
			<col class="w-36" />
			<col class="w-11" />
		</colgroup>
		<thead>
			<tr>
				<th>{@render head('timestamp', t().detections.time, 'desc')}</th>
				<th>{@render head('severity', t().detections.severity, 'desc')}</th>
				<th>{@render head('ruleName', t().detections.detection)}</th>
				{#if showHost}<th>{@render head('hostname', t().detections.host)}</th>{/if}
				<th>{t().detections.user}</th>
				<th>{t().detections.outcome}</th>
				<th>{@render head('status', t().detections.status)}</th>
				<th class="w-10"><span class="sr-only">{t().common.actions}</span></th>
			</tr>
		</thead>
		<tbody>
			{#each items as a (a.id)}
				<tr
					class="clickable"
					aria-selected={selected === a.id}
					tabindex="0"
					onclick={() => onselect(a.id)}
					onkeydown={(e) => {
						if (e.key === 'Enter' || e.key === ' ') {
							e.preventDefault();
							onselect(a.id);
						}
					}}
				>
					<td class="whitespace-nowrap text-muted"><RelTime iso={a.timestamp} /></td>
					<td><StatusBadge kind="severity" value={a.severity} /></td>
					<td>
						<div class="truncate leading-5 font-semibold" title={a.title}>{a.title}</div>
						<!-- The type is a fixed enum and always shown in full; only the file or
						     process name after it may shorten. -->
						<div class="flex min-w-0 text-[12px] leading-4 text-muted">
							<span class="shrink-0">{kindLabel(a.kind)}</span>
							{#if a.subject}<span class="truncate" title={a.subject}>&nbsp;·&nbsp;{a.subject}</span
								>{/if}
						</div>
					</td>
					{#if showHost}
						<td class="truncate" title={a.hostname}>
							{#if a.agentId && a.hostname}
								<a
									href={`/agents/${a.agentId}`}
									class="text-accent hover:underline"
									onclick={(e) => e.stopPropagation()}>{a.hostname}</a
								>
							{:else}{a.hostname ?? '—'}{/if}
						</td>
					{/if}
					<td class="truncate text-muted" title={a.userName}>{a.userName ?? '—'}</td>
					<td><StatusBadge kind="outcome" value={a.outcome} /></td>
					<!-- Two lines at most, like the Detection cell, so every row has the same
					     fixed height; the column fits the longest closing reason in full. -->
					<td class="whitespace-nowrap">
						<div class="flex h-5 items-center">
							<StatusBadge kind="workflow" value={a.status} />
						</div>
						{#if a.closingReason}<div class="pl-[21px] text-[12px] leading-4 text-muted">
								{closingReasonLabel(a.closingReason)}
							</div>{/if}
					</td>
					<td class="py-0">
						<RowMenu
							label={t().common.actionsFor(a.title)}
							actions={[
								{ label: t().detections.viewDetails, onclick: () => onselect(a.id) },
								...(a.agentId
									? [{ label: t().detections.viewAgent, href: `/agents/${a.agentId}` }]
									: []),
								{
									label: t().detections.copyAlertId,
									onclick: () => navigator.clipboard?.writeText(a.id)
								}
							]}
						/>
					</td>
				</tr>
			{:else}
				<tr>
					<td colspan="8" class="py-10 text-center text-muted">
						{emptyText}
						{#if clearHref}
							<a href={clearHref} class="ml-1 text-accent hover:underline"
								>{t().common.clearFilters}</a
							>
						{/if}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>
