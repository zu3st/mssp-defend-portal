<script lang="ts">
	import { page } from '$app/state';
	import { ALERT_KINDS, SEVERITIES, WORKFLOW_STATUSES } from '#lib/contract.ts';
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
		groupIntegrations,
		integrationName
	} from '#lib/ui.ts';
	import { t } from '#lib/i18n/index.svelte.ts';
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
	><ArrowLeft size={14} /> {t().agent.viewAll}</a
>

<div class="mb-4 flex flex-wrap items-start justify-between gap-4">
	<div class="flex items-center gap-3">
		<h2 class="text-xl font-semibold">{a.hostname}</h2>
		{#if a.defend.isolated}
			<span class="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--warn)]"
				><Lock size={13} /> {t().agent.isolated}</span
			>
		{/if}
	</div>
	<dl class="flex flex-wrap gap-x-8 gap-y-2 text-[13px]">
		<div>
			<dt class="text-[12px] text-muted">{t().agent.agentPolicy}</dt>
			<dd>{a.policyName ?? a.policyId ?? '—'}</dd>
		</div>
		<div>
			<dt class="text-[12px] text-muted">{t().agent.agentVersion}</dt>
			<dd class="inline-flex items-center gap-1">
				<span class="tabular-nums">{a.agentVersion ?? '—'}</span>
				{#if a.upgradeAvailable}
					<span class="inline-flex text-accent" title={t().agents.upgradeAvailable}>
						<ArrowUpCircle size={14} aria-hidden="true" /><span class="sr-only"
							>{t().agents.upgradeAvailable}</span
						>
					</span>
				{/if}
			</dd>
		</div>
		<div>
			<dt class="text-[12px] text-muted">{t().agent.agentStatus}</dt>
			<dd><StatusBadge kind="fleet" value={a.fleetStatus} /></dd>
		</div>
		<div>
			<dt class="text-[12px] text-muted">{t().agent.lastActivity}</dt>
			<dd><RelTime iso={a.lastCheckin} /></dd>
		</div>
		<div>
			<dt class="text-[12px] text-muted">{t().agent.openDetections}</dt>
			<dd>
				<a
					href={`${page.url.pathname}?tab=detections&status=open&range=1y`}
					title={t().agent.openDetectionsTitle}
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
	{#each [{ id: 'details', label: t().agent.detailsTab }, { id: 'detections', label: t().agent.detectionsTab }] as tab (tab.id)}
		<a
			href={tab.id === 'details' ? page.url.pathname : `${page.url.pathname}?tab=detections`}
			class="-mb-px border-b-2 px-3 py-2 font-medium"
			class:border-[var(--accent)]={data.tab === tab.id}
			class:text-accent={data.tab === tab.id}
			class:border-transparent={data.tab !== tab.id}
			class:text-muted={data.tab !== tab.id}
			aria-current={data.tab === tab.id ? 'page' : undefined}>{tab.label}</a
		>
	{/each}
</nav>

{#if data.tab === 'details'}
	<div class="grid gap-3 lg:grid-cols-5">
		<section class="card p-4 lg:col-span-3">
			<KeyValues
				title={t().agent.overview}
				items={[
					{ label: t().agent.cpu, value: formatCpu(a.cpuPercent) },
					{ label: t().agent.memory, value: formatMemory(a.memoryBytes) },
					{ label: t().agent.lastActivity, value: formatDate(a.lastCheckin, true) },
					{ label: t().agent.lastCheckinMessage, value: a.lastCheckinMessage },
					{ label: t().agent.agentId, value: a.agentId, id: true },
					{
						label: t().agent.agentPolicy,
						value: `${a.policyName ?? a.policyId ?? '—'}${a.policyRevision !== undefined ? ` (${t().agents.revision(a.policyRevision)})` : ''}`
					},
					{ label: t().agent.agentVersion, value: a.agentVersion },
					{ label: t().agent.hostName, value: a.hostname },
					{ label: t().agent.logLevel, value: a.logLevel },
					{ label: t().agent.platform, value: a.osFull ?? osLabel(a.os) },
					{ label: t().agent.architecture, value: a.architecture },
					{ label: t().agent.enrolled, value: formatDate(a.enrolledAt) },
					{ label: t().agent.tags, value: a.tags.join(', ') }
				]}
			/>
			<div class="mt-4">
				<KeyValues
					title={t().agent.host}
					items={[
						{ label: t().agent.ips, value: a.ips.join(', '), mono: true },
						{ label: t().agent.macs, value: a.macs.join(', '), mono: true },
						{ label: t().agent.kernel, value: a.kernel },
						{ label: t().agent.hostId, value: a.hostId, id: true }
					]}
				/>
			</div>
		</section>

		<div class="space-y-3 lg:col-span-2">
			<section class="card p-4">
				<h3 class="mb-2 text-[11px] font-semibold tracking-wide text-muted uppercase">
					{t().agent.integrations}
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
									<div class="font-medium">{integrationName(row.name)}</div>
									<div class="truncate text-[12px] text-muted">
										{componentLine(row.status, row.message)}
									</div>
								</div>
							</li>
						{/each}
					</ul>
				{:else}
					<div class="text-[13px] text-muted">{t().agent.noComponents}</div>
				{/if}
			</section>

			<!-- Elastic Defend: protection state first, details only when installed -->
			<section class="card p-4">
				<h3 class="mb-2 text-[11px] font-semibold tracking-wide text-muted uppercase">
					Elastic Defend
				</h3>
				{#if a.defend.status === 'not_installed'}
					<p class="text-[13px] text-muted">{t().agent.defendNotInstalled}</p>
				{:else}
					<div class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px]">
						<StatusBadge kind="policy" value={a.defend.status} />
						<span class="text-muted">· {t().agent.policySummary[a.defend.status]}</span>
					</div>
					{#if defendProblem}
						<p class="mt-1 text-[12px] text-muted">{defendProblem}</p>
					{/if}
					<dl
						class="mt-3 grid grid-cols-[minmax(7rem,auto)_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[13px]"
					>
						{#if a.defend.policyName}
							<dt class="text-muted">{t().agent.policy}</dt>
							<dd class="min-w-0 break-words">{a.defend.policyName}</dd>
						{/if}
						{#if a.defend.endpointVersion}
							<dt class="text-muted">{t().agent.endpoint}</dt>
							<dd>{a.defend.endpointVersion}</dd>
						{/if}
						{#if a.defend.isolated !== undefined}
							<dt class="text-muted">{t().agent.isolation}</dt>
							<dd>
								{#if a.defend.isolated}
									<span class="inline-flex items-center gap-1.5 font-medium text-[var(--warn)]"
										><Lock size={14} /> {t().agent.isolated}</span
									>
								{:else}
									<span class="inline-flex items-center gap-1.5 text-muted"
										><LockOpen size={14} /> {t().agent.notIsolated}</span
									>
								{/if}
							</dd>
						{/if}
						{#if a.defend.reportedAt}
							<dt class="text-muted">{t().agent.reported}</dt>
							<dd>
								<RelTime iso={a.defend.reportedAt} />
								{#if offline}<span class="text-muted">{t().agent.lastReportOffline}</span>{/if}
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
				placeholder={t().detections.searchOnHost}
				keep={{ tab: 'detections' }}
				{clearHref}
				active={filtersActive}
			>
				<MultiFilter
					name="severity"
					label={t().detections.severity}
					selected={q.severities ?? []}
					options={SEVERITIES.map((s) => ({ value: s, label: severityLabel(s).label }))}
				/>
				<MultiFilter
					name="status"
					label={t().detections.status}
					selected={q.statuses ?? []}
					options={WORKFLOW_STATUSES.map((s) => ({ value: s, label: workflowLabel[s].label }))}
				/>
				<MultiFilter
					name="kind"
					label={t().detections.type}
					selected={q.kinds ?? []}
					options={ALERT_KINDS.map((k) => ({ value: k, label: kindLabel(k) }))}
				/>
				<MultiFilter
					name="rule"
					freeText
					label={t().detections.rule}
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
			noun={t().pagination.detections}
		/>
	</section>
	<AlertPanel alertId={selected} onclose={() => selected && selectAlert(null)} />
{/if}
