<script lang="ts">
	import type { AlertDetail } from '#lib/contract.ts';
	import { closingReasonLabel, formatDate, severityLabel, toneColor } from '#lib/ui.ts';
	import { t } from '#lib/i18n/index.svelte.ts';
	import StatusBadge from '../StatusBadges.svelte';
	import CopyButton from '../CopyButton.svelte';
	import { ChevronDown, LoaderCircle, X } from '@lucide/svelte';

	/**
	 * Alert flyout modelled on Kibana Security's alert details "Overview" tab:
	 * header (severity, time, rule name), Status / Risk score / Assignees
	 * cards, About, and Investigation → Highlighted fields. Read-only: no Take
	 * action, notes, Table or JSON tabs. Data is the portal's normalized,
	 * allowlisted alert detail, never a raw Elastic document.
	 */
	let { alertId, onclose }: { alertId: string | null; onclose: () => void } = $props();

	let dialog: HTMLDialogElement | undefined = $state();
	let detail: AlertDetail | null = $state(null);
	let error: string | null = $state(null);
	let loading = $state(false);

	$effect(() => {
		const id = alertId;
		if (!id) {
			dialog?.close();
			return;
		}
		if (!dialog?.open) dialog?.showModal();
		const ctrl = new AbortController();
		loading = true;
		error = null;
		fetch(`/api/alerts/${encodeURIComponent(id)}`, {
			signal: ctrl.signal,
			headers: { accept: 'application/json' }
		})
			.then(async (r) => {
				if (r.status === 404) throw new Error(t().alert.notFound);
				if (!r.ok) throw new Error(t().alert.loadFailed);
				detail = (await r.json()) as AlertDetail;
			})
			.catch((e: Error) => {
				if (e.name !== 'AbortError') {
					detail = null;
					error = e.message;
				}
			})
			.finally(() => (loading = false));
		return () => ctrl.abort();
	});

	const isHash = (field: string) => /(^|\.)sha256$/.test(field);
</script>

{#snippet section(title: string)}
	<summary class="flex cursor-pointer list-none items-center gap-2 py-1 text-[15px] font-semibold">
		<ChevronDown size={16} class="chevron transition-transform" />
		{title}
	</summary>
{/snippet}

<dialog
	bind:this={dialog}
	class="sheet"
	aria-label={t().alert.details}
	{onclose}
	onclick={(e) => {
		if (e.target === dialog) dialog?.close();
	}}
>
	<div class="flex h-full flex-col">
		<div class="flex justify-end px-3 pt-3">
			<button
				class="btn h-8 w-8 justify-center border-transparent p-0"
				onclick={() => dialog?.close()}
				aria-label={t().common.close}
			>
				<X size={16} />
			</button>
		</div>

		<div class="flex-1 overflow-y-auto px-6 pb-6">
			{#if loading && !detail}
				<div class="flex items-center gap-2 text-muted">
					<LoaderCircle size={16} class="animate-spin" />
					{t().common.loading}
				</div>
			{:else if error}
				<div class="card p-3 text-[13px] text-[var(--bad)]">{error}</div>
			{:else if detail}
				{@const d = detail}
				<!-- Header -->
				<div class="flex items-center gap-1.5 text-[13px]">
					<span class="h-2 w-2 rounded-full" style:background={toneColor[d.severity]}></span>
					<span>{severityLabel(d.severity).label}</span>
				</div>
				<div class="mt-2 text-[13px] text-muted">{formatDate(d.timestamp, true)}</div>
				<h2 class="mt-0.5 text-[20px] leading-snug font-semibold">{d.ruleName}</h2>

				<!-- The rules behind the alert, which Kibana only shows deep in the field list -->
				{@const sourceRule = d.detectionRule.name ?? d.ruleName}
				{#if d.defendRule || sourceRule !== d.ruleName}
					<dl class="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
						{#if d.defendRule}
							<dt class="text-muted">{t().alert.defendRule}</dt>
							<dd class="font-medium">{d.defendRule.name}</dd>
						{/if}
						<dt class="text-muted">{t().alert.detectionRule}</dt>
						<dd>
							{sourceRule}
							{#if !d.detectionRule.name && d.detectionRule.uuid}
								<span class="text-muted">{t().alert.nameUnavailable}</span>
							{/if}
						</dd>
					</dl>
				{/if}

				<!-- Status / Risk score / Assignees / Outcome -->
				<div
					class={[
						'mt-4 grid grid-cols-2 gap-2',
						d.kind === 'rule' ? 'sm:grid-cols-3' : 'sm:grid-cols-4'
					]}
				>
					<div class="card p-3">
						<div class="text-[13px] font-semibold">{t().alert.status}</div>
						<div class="mt-1.5"><StatusBadge kind="workflow" value={d.status} /></div>
						{#if d.status === 'closed' && d.closingReason}
							<div class="mt-1 text-[12px] text-muted">
								{closingReasonLabel(d.closingReason)}
							</div>
						{/if}
					</div>
					<div class="card p-3">
						<div class="text-[13px] font-semibold">{t().alert.riskScore}</div>
						<div class="mt-1.5 text-[14px] tabular-nums">{d.riskScore ?? '—'}</div>
					</div>
					<div class="card p-3">
						<div class="text-[13px] font-semibold">{t().alert.assignees}</div>
						<div class="mt-1.5 text-[13px]" class:text-muted={d.assignees === 0}>
							{d.assignees === 0 ? t().alert.unassigned : t().alert.analysts(d.assignees)}
						</div>
					</div>
					{#if d.kind !== 'rule'}
						<div class="card p-3">
							<div class="text-[13px] font-semibold">{t().alert.outcome}</div>
							<div class="mt-1.5"><StatusBadge kind="outcome" value={d.outcome} /></div>
						</div>
					{/if}
				</div>

				<!-- About -->
				<details open class="group mt-5 border-b border-line pb-4">
					{@render section(t().alert.about)}
					<div class="mt-2 space-y-4 text-[14px]">
						{#if d.defendRule?.description}
							<div>
								<div class="font-semibold">{t().alert.defendRuleDescription}</div>
								<p class="mt-1 leading-relaxed">{d.defendRule.description}</p>
							</div>
						{/if}
						{#if d.detectionRule.description && !d.defendRule?.description}
							<div>
								<div class="font-semibold">{t().alert.ruleDescription}</div>
								<p class="mt-1 leading-relaxed">{d.detectionRule.description}</p>
							</div>
						{/if}
						{#if d.reason}
							<div>
								<div class="font-semibold">{t().alert.reason}</div>
								<p class="mt-1 leading-relaxed">{d.reason}</p>
							</div>
						{/if}
						{#if d.mitre.length}
							<div>
								<div class="font-semibold">MITRE ATT&CK</div>
								<ul class="mt-1 space-y-0.5">
									{#each d.mitre as m, i (i)}
										<li>
											{m.tactic ?? '—'}{#if m.technique}&nbsp; → {m.technique}{/if}
											{#if m.techniqueId}<span class="text-muted">({m.techniqueId})</span>{/if}
										</li>
									{/each}
								</ul>
							</div>
						{/if}
					</div>
				</details>

				<!-- Investigation -->
				<details open class="group mt-4">
					{@render section(t().alert.investigation)}
					<div class="mt-2">
						<div class="mb-2 text-[14px] font-semibold">{t().alert.highlightedFields}</div>
						<div class="card overflow-hidden">
							<table class="w-full text-[13px]">
								<thead>
									<tr class="border-b border-line bg-surface-2 text-left">
										<th class="w-[38%] px-3 py-2 font-semibold">{t().alert.field}</th>
										<th class="px-3 py-2 font-semibold">{t().alert.value}</th>
									</tr>
								</thead>
								<tbody>
									{#each d.highlighted as h (h.field)}
										<tr class="border-b border-line align-top last:border-0">
											<td class="px-3 py-2 break-all">{h.field}</td>
											<td class="px-3 py-2">
												{#each h.values as v, i (i)}
													<div class="flex items-center gap-1.5">
														{#if h.field === 'host.name' && d.agentId}
															<a class="text-accent hover:underline" href={`/agents/${d.agentId}`}
																>{v}</a
															>
														{:else if isHash(h.field)}
															<span class="mono min-w-0 overflow-x-auto whitespace-nowrap">{v}</span
															>
															<CopyButton value={v} label={t().common.copyThing(h.field)} />
														{:else}
															<span class="break-words">{v}</span>
														{/if}
													</div>
												{/each}
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					</div>
				</details>
			{/if}
		</div>
	</div>
</dialog>

<style>
	.sheet {
		margin: 0 0 0 auto;
		height: 100dvh;
		max-height: 100dvh;
		width: min(52rem, 100vw);
		max-width: 100vw;
		border: 0;
		border-left: 1px solid var(--line);
		background: var(--surface);
		color: var(--fg);
		padding: 0;
	}
	.sheet::backdrop {
		background: rgb(0 0 0 / 0.35);
	}
	details:not([open]) :global(.chevron) {
		transform: rotate(-90deg);
	}
</style>
