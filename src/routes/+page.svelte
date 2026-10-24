<script lang="ts">
	import { goto } from '$app/navigation';
	import type { AgentSummary } from '#lib/contract.ts';
	import { fleetGroupLabel, policyLabel, stripStatusPrefix, toneColor } from '#lib/ui.ts';
	import { rangeLabel, rangeParams } from '#lib/range.ts';
	import { selectAlert, selectedAlert } from '#lib/selection.ts';
	import StatusBadge from '#lib/components/StatusBadges.svelte';
	import AlertTable from '#lib/components/alert/AlertTable.svelte';
	import AlertPanel from '#lib/components/alert/AlertPanel.svelte';
	import SeverityLevels from '#lib/components/SeverityLevels.svelte';
	import RelTime from '#lib/components/RelTime.svelte';
	import { ChevronRight, ShieldAlert, ShieldCheck, Server, ShieldBan } from '@lucide/svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const o = $derived(data.overview);
	const selected = $derived(selectedAlert());

	const active = $derived(o.alerts.byStatus.open + o.alerts.byStatus.acknowledged);
	const withDefend = $derived(
		o.policy.success + o.policy.warning + o.policy.failure + o.policy.unknown
	);
	const range = $derived(rangeLabel(data.timeRange.spec));
	/** Why an endpoint is listed, from the most specific signal available. */
	function attentionReason(a: AgentSummary): string | undefined {
		// Elastic Defend's own unit message beats Fleet's generic "1 or more components…".
		const c = a.defend.componentStatus;
		if ((c === 'FAILED' || c === 'DEGRADED') && a.defend.componentMessage) {
			return `Elastic Defend: ${stripStatusPrefix(a.defend.componentMessage)}`;
		}
		if (a.fleetMessage) return a.fleetMessage;
		if (a.defend.status === 'failure') return 'Elastic Defend policy response: failure';
		if (a.defend.status === 'warning') return 'Elastic Defend policy response: warning';
		if (a.fleetStatusGroup === 'offline') return 'Agent is not checking in';
		if (a.fleetStatusGroup === 'orphaned') return 'Agent has lost contact with Fleet Server';
		return undefined;
	}
	/** Links into Detections keep this page's time range, even one set only by URL. */
	const detectionsHref = (params: Record<string, string>) => {
		const p = new URLSearchParams(params);
		for (const [k, v] of Object.entries(rangeParams(data.timeRange.spec))) if (v) p.set(k, v);
		return `/detections?${p}`;
	};
</script>

<!-- Key numbers -->
<div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
	<a href="/agents" class="card block px-4 py-3 hover:border-[var(--accent)]">
		<div class="flex items-center justify-between text-[13px] text-muted">
			Agents <Server size={16} />
		</div>
		<div class="text-2xl leading-8 font-semibold tabular-nums">{o.agents.total}</div>
		<div class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[12px]">
			{#each ['healthy', 'unhealthy', 'offline', 'updating'] as const as g (g)}
				<span class:text-muted={o.agents[g] === 0}>
					<span class="dot" style:background={toneColor[fleetGroupLabel[g].tone]}></span>{o.agents[
						g
					]}
					{fleetGroupLabel[g].label.toLowerCase()}
				</span>
			{/each}
		</div>
	</a>

	<a href="/agents" class="card block px-4 py-3 hover:border-[var(--accent)]">
		<div class="flex items-center justify-between text-[13px] text-muted">
			Elastic Defend policy status <ShieldCheck size={16} />
		</div>
		<div class="text-2xl leading-8 font-semibold tabular-nums">
			{o.policy.success}<span class="text-[14px] font-normal text-muted"
				>&nbsp;/ {withDefend} success{o.policyCountsCapped ? ' (first 5,000 agents)' : ''}</span
			>
		</div>
		<div class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[12px]">
			{#each ['failure', 'warning', 'unknown', 'not_installed'] as const as s (s)}
				{#if o.policy[s] > 0 || s === 'failure'}
					<span class:text-muted={o.policy[s] === 0}>
						<span class="dot" style:background={toneColor[policyLabel[s].tone]}></span>{o.policy[s]}
						{policyLabel[s].label.toLowerCase()}
					</span>
				{/if}
			{/each}
		</div>
	</a>

	<a
		href={detectionsHref({ status: 'open,acknowledged' })}
		class="card block px-4 py-3 hover:border-[var(--accent)]"
	>
		<div class="flex items-center justify-between text-[13px] text-muted">
			Active detections <ShieldAlert size={16} />
		</div>
		<div class="text-2xl leading-8 font-semibold tabular-nums">{active}</div>
		<div class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[12px]">
			<span class:text-muted={o.alerts.activeBySeverity.critical === 0}
				><span class="dot" style:background={toneColor['critical']}></span>{o.alerts
					.activeBySeverity.critical} critical</span
			>
			<span class:text-muted={o.alerts.activeBySeverity.high === 0}
				><span class="dot" style:background={toneColor['high']}></span>{o.alerts.activeBySeverity
					.high} high</span
			>
			<span class="text-muted"
				>{o.alerts.byStatus.open} open · {o.alerts.byStatus.acknowledged} ack.</span
			>
		</div>
	</a>

	<div class="card px-4 py-3">
		<div class="flex items-center justify-between text-[13px] text-muted">
			Threats prevented <ShieldBan size={16} />
		</div>
		<div class="text-2xl leading-8 font-semibold tabular-nums">
			{o.alerts.prevented}<span class="text-[14px] font-normal text-muted"
				>&nbsp;of {o.alerts.total} detections</span
			>
		</div>
		<div class="mt-1 text-[12px] text-muted">
			Blocked or quarantined by Elastic Defend · {range}
		</div>
	</div>
</div>

<div class="mt-3 grid gap-3 lg:grid-cols-5">
	<!-- Needs attention -->
	<section class="card min-w-0 lg:col-span-3">
		<header class="flex items-center justify-between border-b border-line px-4 py-3">
			<h2 class="font-semibold">
				Agents needing attention
				{#if o.attentionTotal > 0}<span class="ml-1 font-normal text-muted tabular-nums"
						>{o.attentionTotal}</span
					>{/if}
			</h2>
			<a
				href="/agents?status=unhealthy&status=orphaned&status=offline"
				class="text-[12px] text-accent hover:underline"
				>{o.attentionTotal > o.attention.length
					? `Top ${o.attention.length} shown · view agents`
					: 'View agents'}</a
			>
		</header>
		{#if o.attention.length}
			<div class="overflow-x-auto">
				<!-- Fixed layout and row height: every row is two lines (host + reason). -->
				<table class="data-table compact min-w-[36rem] table-fixed">
					<colgroup>
						<col />
						<col class="w-30" />
						<col class="w-30" />
						<col class="w-32" />
					</colgroup>
					<thead
						><tr><th>Host</th><th>Agent status</th><th>Elastic Defend</th><th>Last activity</th></tr
						></thead
					>
					<tbody>
						{#each o.attention as a (a.agentId)}
							<tr class="clickable" onclick={() => goto(`/agents/${a.agentId}`)}>
								<td>
									<a
										href={`/agents/${a.agentId}`}
										class="block truncate leading-5 font-medium text-accent hover:underline"
										title={a.hostname}>{a.hostname}</a
									>
									<div class="truncate text-[12px] leading-4 text-muted" title={attentionReason(a)}>
										{attentionReason(a) ?? ''}
									</div>
								</td>
								<td><StatusBadge kind="fleet" value={a.fleetStatus} /></td>
								<td>
									<StatusBadge kind="policy" value={a.defend.status} />
								</td>
								<td class="whitespace-nowrap text-muted"><RelTime iso={a.lastCheckin} /></td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else}
			<div class="flex items-center gap-2 px-4 py-8 text-muted">
				<ShieldCheck size={16} class="text-[var(--ok)]" /> All agents are healthy and every Elastic Defend
				policy applied successfully.
			</div>
		{/if}
	</section>

	<!-- Detections by severity, like Kibana's "Severity levels" -->
	<section class="card min-w-0 lg:col-span-2">
		<header class="border-b border-line px-4 py-3">
			<h2 class="font-semibold">
				Severity levels
				<span class="ml-1 text-[12px] font-normal text-muted">All statuses · {range}</span>
			</h2>
		</header>
		<div class="px-4 py-4">
			<SeverityLevels
				counts={o.alerts.bySeverity}
				hrefFor={(s) => detectionsHref({ severity: s })}
			/>
		</div>
	</section>
</div>

<section class="card mt-3 min-w-0">
	<header class="flex items-center justify-between border-b border-line px-4 py-3">
		<h2 class="font-semibold">Recent high-priority detections</h2>
		<a
			href={detectionsHref({ severity: 'critical,high', status: 'open,acknowledged' })}
			class="inline-flex items-center text-[12px] text-accent hover:underline"
		>
			All detections <ChevronRight size={14} />
		</a>
	</header>
	<AlertTable
		items={o.recentHighPriority}
		{selected}
		onselect={(id) => selectAlert(id)}
		sortable={false}
		emptyText="No open critical or high detections in this time range."
	/>
</section>

<AlertPanel alertId={selected} onclose={() => selected && selectAlert(null)} />

<style>
	/* Colour comes from toneColor; this only sets the shape. */
	.dot {
		display: inline-block;
		width: 0.45rem;
		height: 0.45rem;
		margin-right: 0.3rem;
		border-radius: 999px;
		vertical-align: 0.05rem;
	}
</style>
