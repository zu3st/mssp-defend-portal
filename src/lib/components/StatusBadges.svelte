<script lang="ts" module>
	export type BadgeKind = 'severity' | 'workflow' | 'outcome' | 'fleet' | 'policy';
</script>

<script lang="ts">
	import {
		policyLabel,
		fleetLabel,
		outcomeLabel,
		severityLabel,
		workflowLabel,
		toneColor,
		type Label
	} from '#lib/ui.ts';
	import type {
		AlertOutcome,
		PolicyStatus,
		FleetStatus,
		Severity,
		WorkflowStatus
	} from '#lib/contract.ts';
	import {
		Ban,
		CircleCheck,
		CircleDot,
		CircleHelp,
		Clock,
		Eye,
		ShieldCheck,
		ShieldOff,
		ShieldX,
		TriangleAlert
	} from '@lucide/svelte';

	/**
	 * Quiet status marker: a coloured dot (severity, Fleet agent status) or a
	 * small icon (outcome, workflow, Defend policy) followed by plain text. No
	 * pill backgrounds, so dense tables stay readable.
	 */
	let { kind, value, title }: { kind: BadgeKind; value: string; title?: string } = $props();

	const l: Label = $derived.by(() => {
		switch (kind) {
			case 'severity':
				return severityLabel(value as Severity);
			case 'workflow':
				return workflowLabel[value as WorkflowStatus];
			case 'outcome':
				return outcomeLabel[value as AlertOutcome];
			case 'fleet':
				return fleetLabel[value as FleetStatus];
			default:
				return policyLabel[value as PolicyStatus];
		}
	});

	const ICONS = {
		outcome: { prevented: ShieldCheck, detected: Eye, unknown: Ban },
		workflow: { open: CircleDot, acknowledged: Clock, closed: CircleCheck },
		policy: {
			success: ShieldCheck,
			warning: TriangleAlert,
			failure: ShieldX,
			unknown: CircleHelp,
			not_installed: ShieldOff
		}
	} as const;
	const Icon = $derived(
		kind === 'outcome' || kind === 'workflow' || kind === 'policy'
			? (ICONS[kind] as Record<string, typeof Eye>)[value]
			: undefined
	);
	const color = $derived(toneColor[l?.tone ?? 'neutral']);
</script>

<span class="inline-flex items-center gap-1.5 whitespace-nowrap" {title}>
	{#if Icon}
		<Icon size={15} style={`color: ${color}`} aria-hidden="true" />
	{:else}
		<span class="h-2 w-2 shrink-0 rounded-full" style:background={color} aria-hidden="true"></span>
	{/if}
	{l?.label ?? value}
</span>
