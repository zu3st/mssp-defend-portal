<script lang="ts">
	import { page } from '$app/state';
	import { ALERT_KINDS, SEVERITIES, WORKFLOW_STATUSES, type PolicyStatus } from '#lib/contract.ts';
	import { withRange } from '#lib/range.ts';
	import {
		componentLine,
		formatCpu,
		kindLabel,
		stripStatusPrefix,
		formatDate,
		formatMemory,
		osLabel,
		severityLabel,
		workflowLabel,
		toneColor,
		groupIntegrations
	} from '#lib/ui.ts';
	import { selectAlert, selectedAlert } from '#lib/selection.ts';
	import KeyValues from '#lib/components/KeyValues.svelte';
	import StatusBadge from '#lib/components/StatusBadges.svelte';
	import FilterForm from '#lib/components/FilterForm.svelte';
	import MultiFilter from '#lib/components/MultiFilter.svelte';
	import Pagination from '#lib/components/Pagination.svelte';
	import AlertTable from '#lib/components/alert/AlertTable.svelte';
	import AlertPanel from '#lib/components/alert/AlertPanel.svelte';
	import RelTime from '#lib/components/RelTime.svelte';
	import { startAutoRefresh } from '#lib/refresh.ts';
	import { ArrowLeft, ArrowUpCircle, Lock, LockOpen } from '@lucide/svelte';
	import type { PageProps } from './$types';

	/** Mirrors Kibana Fleet's agent details page, plus a Detections tab. */
	let { data }: PageProps = $props();
	const a = $derived(data.agent);
	const selected = $derived(selectedAlert());
	// Agent details poll every 30 seconds, as in Fleet. The Detections tab
	// follows the time picker's "Refresh every" instead.
	$effect(() => (data.tab === 'details' ? startAutoRefresh(30_000) : undefined));

	const componentTone = (s: string) =>
		toneColor[
			s === 'HEALTHY' ? 'ok' : s === 'FAILED' ? 'bad' : s === 'DEGRADED' ? 'warn' : 'neutral'
		];

	const integrations = $derived(groupIntegrations(a.components));

	/** One-line meaning of the Defend policy response, shown beside its status. */
	const POLICY_SUMMARY: Record<PolicyStatus, string> = {
		success: 'Policy applied',
		warning: 'Policy applied with warnings',
		failure: 'Policy could not be fully applied',
		unknown: 'No policy response reported',
		not_installed: ''
	};
	const defendProblem = $derived(
		a.defend.componentStatus && a.defend.componentStatus !== 'HEALTHY'
			? a.defend.componentMessage && stripStatusPrefix(a.defend.componentMessage)
			: undefined
	);
	const offline = $derived(a.fleetStatusGroup === 'offline' || a.fleetStatusGroup === 'inactive');
</script>

<a
	href="/agents"
	class="mb-3 inline-flex items-center gap-1 text-[13px] text-accent hover:underline"
	><ArrowLeft size={14} /> View all agents</a
>

<div class="mb-4 flex flex-wrap items-start justify-between gap-4">
	<div class="flex items-center gap-3">
		<h2 class="text-xl font-semibold">{a.hostname}</h2>
		{#if a.defend.isolated}
			<span class="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--warn)]"
				><Lock size={13} /> Isolated</span
			>
		{/if}
	</div>
	<dl class="flex flex-wrap gap-x-8 gap-y-2 text-[13px]">
		<div>
			<dt class="text-[12px] text-muted">Agent policy</dt>
			<dd>{a.policyName ?? a.policyId ?? '—'}</dd>
		</div>
		<div>
			<dt class="text-[12px] text-muted">Agent version</dt>
			<dd class="inline-flex items-center gap-1">
				<span class="tabular-nums">{a.agentVersion ?? '—'}</span>
				{#if a.upgradeAvailable}
					<span class="inline-flex text-accent" title="Upgrade available">
						<ArrowUpCircle size={14} aria-hidden="true" /><span class="sr-only"
							>Upgrade available</span
						>
					</span>
				{/if}
			</dd>
		</div>
		<div>
			<dt class="text-[12px] text-muted">Agent status</dt>
			<dd><StatusBadge kind="fleet" value={a.fleetStatus} /></dd>
		</div>
		<div>
			<dt class="text-[12px] text-muted">Last activity</dt>
			<dd><RelTime iso={a.lastCheckin} /></dd>
		</div>
		<div>
			<dt class="text-[12px] text-muted">Open detections</dt>
			<dd>
				<a
					href={`${page.url.pathname}?tab=detections&status=open&range=1y`}
					title="Open detections from the last year"
					class={[
						'tabular-nums hover:underline',
						a.alerts.open > 0 ? 'text-[var(--bad)]' : 'text-muted'
					]}>{a.alerts.open}</a
				>
			</dd>
		</div>
	</dl>
</div>

<nav class="mb-4 flex gap-1 border-b border-line text-[14px]">
	{#each [{ id: 'details', label: 'Agent details' }, { id: 'detections', label: 'Detections' }] as t (t.id)}
		<a
			href={t.id === 'details' ? page.url.pathname : `${page.url.pathname}?tab=detections`}
			class="-mb-px border-b-2 px-3 py-2 font-medium"
			class:border-[var(--accent)]={data.tab === t.id}
			class:text-accent={data.tab === t.id}
			class:border-transparent={data.tab !== t.id}
			class:text-muted={data.tab !== t.id}
			aria-current={data.tab === t.id ? 'page' : undefined}>{t.label}</a
		>
	{/each}
</nav>

{#if data.tab === 'details'}
	<div class="grid gap-3 lg:grid-cols-5">
		<section class="card p-4 lg:col-span-3">
			<KeyValues
				title="Overview"
				items={[
					{ label: 'CPU', value: formatCpu(a.cpuPercent) },
					{ label: 'Memory', value: formatMemory(a.memoryBytes) },
					{ label: 'Last activity', value: formatDate(a.lastCheckin, true) },
					{ label: 'Last checkin message', value: a.lastCheckinMessage },
					{ label: 'Agent ID', value: a.agentId, id: true },
					{
						label: 'Agent policy',
						value: `${a.policyName ?? a.policyId ?? '—'}${a.policyRevision !== undefined ? ` (rev. ${a.policyRevision})` : ''}`
					},
					{ label: 'Agent version', value: a.agentVersion },
					{ label: 'Host name', value: a.hostname },
					{ label: 'Logging level', value: a.logLevel },
					{ label: 'Platform', value: a.osFull ?? osLabel(a.os) },
					{ label: 'Architecture', value: a.architecture },
					{ label: 'Enrolled', value: formatDate(a.enrolledAt) },
					{ label: 'Tags', value: a.tags.join(', ') }
				]}
			/>
			<div class="mt-4">
				<KeyValues
					title="Host"
					items={[
						{ label: 'IP addresses', value: a.ips.join(', '), mono: true },
						{ label: 'MAC addresses', value: a.macs.join(', '), mono: true },
						{ label: 'Kernel', value: a.kernel },
						{ label: 'Host ID', value: a.hostId, id: true }
					]}
				/>
			</div>
		</section>

		<div class="space-y-3 lg:col-span-2">
			<section class="card p-4">
				<h3 class="mb-2 text-[11px] font-semibold tracking-wide text-muted uppercase">
					Integrations
				</h3>
				{#if integrations.length}
					<ul class="divide-y divide-[var(--line)] text-[13px]">
						{#each integrations as row (row.name)}
							<li class="flex items-start gap-2 py-2" title={row.message}>
								<span
									class="mt-1.5 h-2 w-2 shrink-0 rounded-full"
									style:background={componentTone(row.status)}
								></span>
								<div class="min-w-0">
									<div class="font-medium">{row.name}</div>
									<div class="truncate text-[12px] text-muted">
										{componentLine(row.status, row.message)}
									</div>
								</div>
							</li>
						{/each}
					</ul>
				{:else}
					<div class="text-[13px] text-muted">No component status reported.</div>
				{/if}
			</section>

			<!-- Elastic Defend: protection state first, details only when installed -->
			<section class="card p-4">
				<h3 class="mb-2 text-[11px] font-semibold tracking-wide text-muted uppercase">
					Elastic Defend
				</h3>
				{#if a.defend.status === 'not_installed'}
					<p class="text-[13px] text-muted">Elastic Defend isn't installed on this agent.</p>
				{:else}
					<div class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px]">
						<StatusBadge kind="policy" value={a.defend.status} />
						<span class="text-muted">· {POLICY_SUMMARY[a.defend.status]}</span>
					</div>
					{#if defendProblem}
						<p class="mt-1 text-[12px] text-muted">{defendProblem}</p>
					{/if}
					<dl
						class="mt-3 grid grid-cols-[minmax(7rem,auto)_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[13px]"
					>
						{#if a.defend.policyName}
							<dt class="text-muted">Policy</dt>
							<dd class="min-w-0 break-words">{a.defend.policyName}</dd>
						{/if}
						{#if a.defend.endpointVersion}
							<dt class="text-muted">Endpoint</dt>
							<dd>{a.defend.endpointVersion}</dd>
						{/if}
						{#if a.defend.isolated !== undefined}
							<dt class="text-muted">Isolation</dt>
							<dd>
								{#if a.defend.isolated}
									<span class="inline-flex items-center gap-1.5 font-medium text-[var(--warn)]"
										><Lock size={14} /> Isolated</span
									>
								{:else}
									<span class="inline-flex items-center gap-1.5 text-muted"
										><LockOpen size={14} /> Not isolated</span
									>
								{/if}
							</dd>
						{/if}
						{#if a.defend.reportedAt}
							<dt class="text-muted">Reported</dt>
							<dd>
								<RelTime iso={a.defend.reportedAt} />
								{#if offline}<span class="text-muted"> · last report, agent offline</span>{/if}
							</dd>
						{/if}
					</dl>
				{/if}
			</section>
		</div>
	</div>
{:else if data.alerts && data.query && data.facets}
	{@const q = data.query}
	{@const filtersActive = !!(q.search || q.severities || q.statuses || q.kinds || q.ruleIds)}
	{@const clearHref = withRange(`${page.url.pathname}?tab=detections`, page.url)}
	<section class="card">
		<header class="border-b border-line p-3">
			<FilterForm
				search={q.search}
				placeholder="Search user, rule, file, process or SHA256"
				keep={{ tab: 'detections' }}
				{clearHref}
				active={filtersActive}
			>
				<MultiFilter
					name="severity"
					label="Severity"
					selected={q.severities ?? []}
					options={SEVERITIES.map((s) => ({ value: s, label: severityLabel(s).label }))}
				/>
				<MultiFilter
					name="status"
					label="Status"
					selected={q.statuses ?? []}
					options={WORKFLOW_STATUSES.map((s) => ({ value: s, label: workflowLabel[s].label }))}
				/>
				<MultiFilter
					name="kind"
					label="Type"
					selected={q.kinds ?? []}
					options={ALERT_KINDS.map((k) => ({ value: k, label: kindLabel[k] }))}
				/>
				<MultiFilter
					name="rule"
					freeText
					label="Rule"
					selected={q.ruleIds ?? []}
					options={data.facets.rules.map((r) => ({ value: r.id, label: r.name }))}
				/>
			</FilterForm>
		</header>
		<AlertTable
			items={data.alerts.items}
			{selected}
			onselect={(id) => selectAlert(id)}
			sort={q.sort}
			dir={q.dir}
			showHost={false}
			clearHref={filtersActive ? clearHref : undefined}
		/>
		<Pagination
			page={data.alerts.page}
			pageSize={data.alerts.pageSize}
			total={data.alerts.total}
			lowerBound={data.alerts.totalIsLowerBound}
			noun="detections"
		/>
	</section>
	<AlertPanel alertId={selected} onclose={() => selected && selectAlert(null)} />
{/if}
