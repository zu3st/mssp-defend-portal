<script lang="ts">
	import { goto } from '$app/navigation';
	import { SEVERITIES, type Severity } from '#lib/contract.ts';
	import { severityLabel, toneColor } from '#lib/ui.ts';
	import StatusBadge from './StatusBadges.svelte';

	/**
	 * Kibana-style "Severity levels": a Levels | Count table and a thin donut that
	 * act as one widget. Hovering a row or a slice highlights both; clicking
	 * either opens the detections filtered to that severity. The table carries the
	 * exact numbers, so colour is never the only key.
	 */
	let { counts, hrefFor }: { counts: Record<Severity, number>; hrefFor: (s: Severity) => string } =
		$props();

	const SIZE = 124; // viewBox units
	const R = 46;
	const STROKE = 12;
	const HIT = 10; // extra hover tolerance either side of the ring, in viewBox units
	const C = 2 * Math.PI * R;
	const GAP = 2; // surface gap between slices, along the ring

	let active: Severity | null = $state(null);
	const total = $derived(SEVERITIES.reduce((n, s) => n + counts[s], 0));
	const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);

	/** Slices in clockwise order from 12 o'clock, with their angular range [from, to) in 0..1. */
	const slices = $derived.by(() => {
		let at = 0;
		return SEVERITIES.filter((s) => counts[s] > 0).map((s) => {
			const share = counts[s] / total;
			const len = share * C;
			const slice = {
				s,
				from: at / C,
				to: (at + len) / C,
				// A lone slice is a full ring, so it gets no gap.
				dash: Math.max(len - (share === 1 ? 0 : GAP), 0.5),
				offset: at
			};
			at += len;
			return slice;
		});
	});

	/**
	 * Slice under the pointer, by angle around the ring. The gaps between slices
	 * belong to the slice they end, so moving along the ring never flickers back
	 * to "nothing"; leaving the ring band (including into the hole) clears it.
	 */
	function sliceAt(e: PointerEvent): Severity | null {
		const svg = e.currentTarget as SVGSVGElement;
		const rect = svg.getBoundingClientRect();
		const scale = SIZE / rect.width;
		const x = (e.clientX - rect.left) * scale - SIZE / 2;
		const y = (e.clientY - rect.top) * scale - SIZE / 2;
		const dist = Math.hypot(x, y);
		if (Math.abs(dist - R) > STROKE / 2 + HIT) return null;
		const turn = (Math.atan2(x, -y) / (2 * Math.PI) + 1) % 1; // 0 at 12 o'clock, clockwise
		return slices.find((sl) => turn >= sl.from && turn < sl.to)?.s ?? null;
	}
</script>

<div class="flex items-center gap-6">
	<table class="min-w-0 flex-1 text-[13px]">
		<thead>
			<tr class="text-[12px] text-muted">
				<th class="pb-1.5 text-left font-medium">Levels</th>
				<th class="pb-1.5 text-right font-medium">Count</th>
			</tr>
		</thead>
		<tbody>
			{#each SEVERITIES as s (s)}
				<!-- Whole row is the target; the link inside keeps it keyboard- and screen-reader-friendly. -->
				<tr
					class="cursor-pointer border-t border-line"
					class:bg-surface-2={active === s}
					onpointerenter={() => (active = s)}
					onpointerleave={() => (active = null)}
					onclick={() => goto(hrefFor(s))}
				>
					<td class="py-1.5 pl-1">
						<a
							href={hrefFor(s)}
							class="focus-visible:outline-offset-4"
							onclick={(e) => e.stopPropagation()}
							onfocus={() => (active = s)}
							onblur={() => (active = null)}
						>
							<StatusBadge kind="severity" value={s} />
						</a>
					</td>
					<td class="py-1.5 pr-1 text-right tabular-nums">{counts[s].toLocaleString()}</td>
				</tr>
			{/each}
		</tbody>
	</table>

	<div class="relative h-[152px] w-[152px] shrink-0">
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
		<svg
			viewBox="0 0 {SIZE} {SIZE}"
			class="h-full w-full"
			class:cursor-pointer={active !== null}
			role="img"
			aria-label="Detections by severity"
			onpointermove={(e) => (active = sliceAt(e))}
			onpointerleave={() => (active = null)}
			onclick={() => active && goto(hrefFor(active))}
		>
			<g transform="rotate(-90 {SIZE / 2} {SIZE / 2})">
				<circle
					cx={SIZE / 2}
					cy={SIZE / 2}
					r={R}
					fill="none"
					stroke="var(--surface-2)"
					stroke-width={STROKE}
				/>
				{#each slices as sl (sl.s)}
					<circle
						cx={SIZE / 2}
						cy={SIZE / 2}
						r={R}
						fill="none"
						stroke={toneColor[sl.s]}
						stroke-width={STROKE}
						stroke-dasharray="{sl.dash} {C - sl.dash}"
						stroke-dashoffset={-sl.offset}
						opacity={active && active !== sl.s ? 0.3 : 1}
						class="pointer-events-none transition-opacity duration-150"
					/>
				{/each}
			</g>
		</svg>
		<div
			class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center"
			aria-live="polite"
		>
			{#if active}
				<div class="text-xl leading-6 font-semibold tabular-nums">
					{counts[active].toLocaleString()}
				</div>
				<div class="text-[12px] text-muted">
					{severityLabel(active).label} · {pct(counts[active])}%
				</div>
			{:else}
				<div class="text-xl leading-6 font-semibold tabular-nums">{total.toLocaleString()}</div>
				<div class="text-[12px] text-muted">detections</div>
			{/if}
		</div>
	</div>
</div>
