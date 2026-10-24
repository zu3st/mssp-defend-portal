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
			placeholder="Search host, user, rule, file, process or SHA256"
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
		noun="detections"
	/>
</div>

<AlertPanel alertId={selected} onclose={() => selected && selectAlert(null)} />
