<script lang="ts">
	import { page } from '$app/state';
	import { withRange } from '#lib/range.ts';
	import { ALERT_KINDS, SEVERITIES, WORKFLOW_STATUSES } from '#lib/contract.ts';
	import { kindLabel, severityLabel, workflowLabel } from '#lib/ui.ts';
	import { selectAlert, selectedAlert } from '#lib/selection.ts';
	import FilterForm from '#lib/components/FilterForm.svelte';
	import MultiFilter from '#lib/components/MultiFilter.svelte';
	import Pagination from '#lib/components/Pagination.svelte';
	import AlertTable from '#lib/components/alert/AlertTable.svelte';
	import AlertPanel from '#lib/components/alert/AlertPanel.svelte';
	import { t } from '#lib/i18n/index.svelte.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const q = $derived(data.query);
	const selected = $derived(selectedAlert());
	const filtersActive = $derived(
		!!(q.search || q.severities || q.statuses || q.kinds || q.ruleIds || q.hostname)
	);
	const clearHref = $derived(withRange('/detections', page.url));
</script>

<div class="card">
	<div class="border-b border-line p-3">
		<FilterForm
			search={q.search}
			placeholder={t().detections.search}
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
	</div>

	<AlertTable
		items={data.alerts.items}
		{selected}
		onselect={(id) => selectAlert(id)}
		sort={q.sort}
		dir={q.dir}
		clearHref={filtersActive ? clearHref : undefined}
	/>
	<Pagination
		page={data.alerts.page}
		pageSize={data.alerts.pageSize}
		total={data.alerts.total}
		lowerBound={data.alerts.totalIsLowerBound}
		noun={t().pagination.detections}
	/>
</div>

<AlertPanel alertId={selected} onclose={() => selected && selectAlert(null)} />
