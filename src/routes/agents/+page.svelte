<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import type { FleetStatusGroup } from '#lib/contract.ts';
	import { fleetGroupLabel, formatCpu, formatMemory, toneColor } from '#lib/ui.ts';
	import FilterForm from '#lib/components/FilterForm.svelte';
	import MultiFilter from '#lib/components/MultiFilter.svelte';
	import Pagination from '#lib/components/Pagination.svelte';
	import SortHeader from '#lib/components/SortHeader.svelte';
	import StatusBadge from '#lib/components/StatusBadges.svelte';
	import RelTime from '#lib/components/RelTime.svelte';
	import { startAutoRefresh } from '#lib/refresh.ts';
	import { ArrowUpCircle, Lock } from '@lucide/svelte';
	import type { PageProps } from './$types';

	/**
	 * Mirrors Kibana Fleet → Agents: status/tags/policy/upgrade filters, the
	 * status summary bar and the Status · Host · Agent policy · CPU · Memory ·
	 * Last activity · Version columns. Two portal additions at the end: the
	 * Elastic Defend policy status and this customer's open detections.
	 * Refreshes every 30 seconds, as Fleet does.
	 */
	let { data }: PageProps = $props();
	// Fleet's agent list polls on its own; so does this one.
	$effect(() => startAutoRefresh(30_000));
	const q = $derived(data.query);
	const summary = $derived(data.agents.statusSummary);
	const GROUPS = Object.keys(fleetGroupLabel) as FleetStatusGroup[];
	const summaryTotal = $derived(GROUPS.reduce((n, g) => n + summary[g], 0));
	const filtersActive = $derived(
		!!(
			q.search ||
			page.url.searchParams.has('status') ||
			q.versions ||
			q.tags ||
			q.policyIds ||
			q.upgradeAvailable
		)
	);
</script>

<div class="card">
	<div class="border-b border-line p-3">
		<FilterForm
			search={q.search}
			placeholder="Search by host name or agent ID"
			clearHref="/agents"
			active={filtersActive}
		>
			<MultiFilter
				name="status"
				label="Status"
				selected={q.statusGroups ?? []}
				options={GROUPS.map((g) => ({ value: g, label: fleetGroupLabel[g].label }))}
			/>
			<MultiFilter
				name="tag"
				freeText
				label="Tags"
				selected={q.tags ?? []}
				options={data.facets.tags.map((t) => ({ value: t, label: t }))}
			/>
			<MultiFilter
				name="policy"
				freeText
				label="Agent policy"
				selected={q.policyIds ?? []}
				options={data.facets.policies.map((p) => ({ value: p.id, label: p.name }))}
			/>
			<label class="btn cursor-pointer" class:text-accent={q.upgradeAvailable}>
				<input
					type="checkbox"
					name="upgrade"
					value="1"
					checked={q.upgradeAvailable}
					class="accent-[var(--accent)]"
				/>
				Upgrade available
			</label>
			<MultiFilter
				name="version"
				freeText
				label="Version"
				selected={q.versions ?? []}
				options={data.facets.versions.map((v) => ({ value: v, label: v }))}
			/>
		</FilterForm>
	</div>

	<!-- Fleet status summary -->
	<div class="border-b border-line px-3 py-2.5">
		<div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
			<!-- Widths reserved for up to 99,999 agents / 9,999 per status, so the
			     legend never shifts when filters change the counts. -->
			<span class="grid text-muted tabular-nums">
				<span class="invisible col-start-1 row-start-1" aria-hidden="true"
					>Showing {(99999).toLocaleString()} agents</span
				>
				<span class="col-start-1 row-start-1"
					>Showing {data.agents.total.toLocaleString()} agents</span
				>
			</span>
			{#each GROUPS as g (g)}
				<span class="inline-flex items-center gap-1.5">
					<span class="h-2 w-2 rounded-full" style:background={toneColor[fleetGroupLabel[g].tone]}
					></span>
					{fleetGroupLabel[g].label}
					<span class="min-w-[5ch] rounded bg-surface-2 px-1 text-center text-[12px] tabular-nums"
						>{summary[g].toLocaleString()}</span
					>
				</span>
			{/each}
		</div>
		{#if summaryTotal > 0}
			<div class="mt-2 flex h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
				{#each GROUPS as g (g)}
					{#if summary[g] > 0}
						<div
							style:width={`${(summary[g] / summaryTotal) * 100}%`}
							style:background={toneColor[fleetGroupLabel[g].tone]}
						></div>
					{/if}
				{/each}
			</div>
		{/if}
	</div>

	<div class="overflow-x-auto">
		<!-- Fixed layout: column widths never depend on the rows currently shown. -->
		<table class="data-table min-w-[68rem] table-fixed">
			<colgroup>
				<col class="w-28" />
				<col />
				<col class="w-44" />
				<col class="w-20" />
				<col class="w-22" />
				<col class="w-30" />
				<col class="w-24" />
				<col class="w-32" />
				<col class="w-34" />
			</colgroup>
			<thead>
				<tr>
					<th>Status</th>
					<th><SortHeader field="hostname" label="Host" sort={q.sort} dir={q.dir} /></th>
					<th><SortHeader field="policy" label="Agent policy" sort={q.sort} dir={q.dir} /></th>
					<th class="text-right">CPU</th>
					<th class="text-right">Memory</th>
					<th>
						<SortHeader
							field="lastCheckin"
							label="Last activity"
							sort={q.sort}
							dir={q.dir}
							defaultDir="desc"
						/>
					</th>
					<th>
						<SortHeader
							field="agentVersion"
							label="Version"
							sort={q.sort}
							dir={q.dir}
							defaultDir="desc"
						/>
					</th>
					<th title="Elastic Defend policy response, as in Security → Endpoints">
						Elastic Defend
					</th>
					<th class="text-right">Open detections</th>
				</tr>
			</thead>
			<tbody>
				{#each data.agents.items as a (a.agentId)}
					<tr class="clickable" onclick={() => goto(`/agents/${a.agentId}`)}>
						<td><StatusBadge kind="fleet" value={a.fleetStatus} title={a.fleetMessage} /></td>
						<td class="truncate">
							<a
								href={`/agents/${a.agentId}`}
								class="font-medium text-accent hover:underline"
								onclick={(e) => e.stopPropagation()}>{a.hostname}</a
							>
							{#if a.defend.isolated}
								<span
									class="ml-2 inline-flex items-center gap-1 align-[-2px] text-[12px] text-[var(--warn)]"
									title="Network isolated by Elastic Defend"
								>
									<Lock size={12} /> Isolated
								</span>
							{/if}
						</td>
						<td>
							<div class="truncate" title={a.policyName ?? a.policyId}>
								{a.policyName ?? a.policyId ?? '—'}
							</div>
							{#if a.policyRevision !== undefined}
								<div class="text-[12px] text-muted">rev. {a.policyRevision}</div>
							{/if}
						</td>
						<td class="text-right whitespace-nowrap tabular-nums">{formatCpu(a.cpuPercent)}</td>
						<td class="text-right whitespace-nowrap tabular-nums">
							{formatMemory(a.memoryBytes)}
						</td>
						<td class="whitespace-nowrap text-muted"><RelTime iso={a.lastCheckin} /></td>
						<td class="whitespace-nowrap">
							<span class="tabular-nums">{a.agentVersion ?? '—'}</span>
							{#if a.upgradeAvailable}
								<span class="ml-1 inline-flex align-[-2px] text-accent" title="Upgrade available">
									<ArrowUpCircle size={14} />
								</span>
							{/if}
						</td>
						<td>
							<StatusBadge kind="policy" value={a.defend.status} title={a.defend.policyName} />
						</td>
						<td
							class={[
								'text-right font-medium tabular-nums',
								a.alerts.open > 0 ? 'text-[var(--bad)]' : 'text-muted'
							]}
						>
							{a.alerts.open}
						</td>
					</tr>
				{:else}
					<tr>
						<td colspan="9" class="py-10 text-center text-muted">
							No agents match the current filters.
							{#if filtersActive}
								<a href="/agents" class="ml-1 text-accent hover:underline">Clear filters</a>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	<Pagination
		page={data.agents.page}
		pageSize={data.agents.pageSize}
		total={data.agents.total}
		noun="agents"
	/>
</div>
