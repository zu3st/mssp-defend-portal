<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { closeOnOutsideClick } from '#lib/actions.ts';
	import { withParams } from '#lib/ui.ts';
	import { startAutoRefresh } from '#lib/refresh.ts';
	import {
		COMMONLY_USED,
		MAX_RANGE_DAYS,
		UNITS,
		parseRelative,
		rangeLabel,
		rangeParams,
		sameRange,
		specToCookie,
		validSpec,
		type RangeSpec,
		type Unit
	} from '#lib/range.ts';
	import { t } from '#lib/i18n/index.svelte.ts';
	import { CalendarDays, ChevronDown, Pause, Play, RotateCw } from '@lucide/svelte';

	/**
	 * Kibana-style date picker for the top bar: Quick select (Last N units),
	 * Commonly used ranges, an absolute Custom range and "Refresh every"
	 * (auto-refresh, off by default), plus a Refresh button. The range is kept
	 * for the session in a cookie and the interval in sessionStorage, so every
	 * view with a time range behaves the same, like Kibana's global time.
	 */
	let {
		value,
		from,
		to
	}: {
		value: RangeSpec;
		/** Resolved bounds (ISO), used to prefill the custom range. */
		from: string;
		to: string;
	} = $props();

	let el: HTMLDetailsElement | undefined = $state();
	let refreshing = $state(false);

	const rel = $derived(parseRelative(value.key));
	let quickN = $state(7);
	let quickUnit: Unit = $state('d');
	let customFrom = $state('');
	let customTo = $state('');
	/** Which form last asked for a range beyond the portal's limit. */
	let tooLong: 'quick' | 'custom' | null = $state(null);

	/** Local calendar date of an instant, YYYY-MM-DD. */
	const localDay = (iso: string) => {
		const d = new Date(iso);
		const pad = (n: number) => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
	};

	/** Prefill the forms from the current range each time the panel opens. */
	function onToggle() {
		if (!el?.open) return;
		tooLong = null;
		quickN = rel?.n ?? 7;
		quickUnit = rel?.unit ?? 'd';
		customFrom = value.from ?? localDay(from);
		customTo = value.to ?? localDay(to);
	}

	const hrefFor = (spec: RangeSpec) => withParams(page.url, rangeParams(spec));

	function remember(spec: RangeSpec) {
		document.cookie = `range=${encodeURIComponent(specToCookie(spec))}; path=/; samesite=lax`;
		if (el) el.open = false;
	}

	function apply(spec: RangeSpec | null, form: 'quick' | 'custom') {
		tooLong = spec ? null : form;
		if (!spec) return;
		remember(spec);
		goto(hrefFor(spec), { reset: false });
	}

	async function refresh() {
		refreshing = true;
		await invalidateAll();
		refreshing = false;
	}

	// Auto-refresh ("Refresh every"), in seconds; null = off.
	const STORE = 'portal.autoRefresh';
	const REFRESH_UNITS = { s: 1, m: 60, h: 3600 } as const;
	type RefreshUnit = keyof typeof REFRESH_UNITS;
	const MIN_REFRESH = 10;
	let autoSec: number | null = $state(null);
	let refreshN = $state(30);
	let refreshUnit: RefreshUnit = $state('s');

	/** "30s", "5m", "1h" */
	const short = (sec: number) =>
		sec % 3600 === 0 ? `${sec / 3600}h` : sec % 60 === 0 ? `${sec / 60}m` : `${sec}s`;

	$effect(() => {
		try {
			const v = Number(sessionStorage.getItem(STORE));
			if (v >= MIN_REFRESH) {
				autoSec = v;
				[refreshN, refreshUnit] =
					v % 3600 === 0 ? [v / 3600, 'h'] : v % 60 === 0 ? [v / 60, 'm'] : [v, 's'];
			}
		} catch {
			// Storage unavailable (private mode): the interval just isn't remembered.
		}
	});
	$effect(() => (autoSec ? startAutoRefresh(autoSec * 1000) : undefined));

	function setAuto(sec: number | null) {
		autoSec = sec;
		try {
			if (sec) sessionStorage.setItem(STORE, String(sec));
			else sessionStorage.removeItem(STORE);
		} catch {
			// See above.
		}
	}
	const refreshSec = $derived(
		Math.max(MIN_REFRESH, Math.round(refreshN * REFRESH_UNITS[refreshUnit]))
	);
</script>

<div class="flex items-center gap-1">
	<details class="relative" bind:this={el} use:closeOnOutsideClick ontoggle={onToggle}>
		<summary class="btn h-8 cursor-pointer list-none" aria-label={t().range.label}>
			<CalendarDays size={15} class="text-muted" />
			<span class="whitespace-nowrap">{rangeLabel(value)}</span>
			<ChevronDown size={14} class="opacity-60" />
		</summary>
		<div
			class="card absolute top-full right-0 z-30 mt-1 w-[22rem] space-y-4 p-3 text-[13px] shadow-lg max-sm:fixed max-sm:inset-x-4 max-sm:top-14 max-sm:w-auto"
		>
			<form
				class="space-y-1.5"
				onsubmit={(e) => {
					e.preventDefault();
					apply(validSpec({ key: `${quickN}${quickUnit}` }), 'quick');
				}}
			>
				<div class="text-[11px] font-semibold tracking-wide text-muted uppercase">
					{t().range.quickSelect}
				</div>
				<div class="flex items-center gap-2">
					<span class="text-muted">{t().range.last}</span>
					<input
						class="input h-8 w-16"
						type="number"
						min="1"
						max="999"
						required
						aria-label={t().range.amount}
						bind:value={quickN}
					/>
					<select class="input h-8 flex-1" aria-label={t().range.unit} bind:value={quickUnit}>
						{#each UNITS as u (u)}<option value={u}>{t().range.units[u]}</option>{/each}
					</select>
					<button class="btn btn-primary h-8" type="submit">{t().common.apply}</button>
				</div>
				{#if tooLong === 'quick'}<p class="text-[12px] text-[var(--bad)]">
						{t().range.upTo(MAX_RANGE_DAYS)}
					</p>{/if}
			</form>

			<div class="space-y-1.5">
				<div class="text-[11px] font-semibold tracking-wide text-muted uppercase">
					{t().range.commonlyUsed}
				</div>
				<ul class="grid grid-cols-2 gap-x-4 gap-y-1">
					{#each COMMONLY_USED as key (key)}
						{@const spec = { key }}
						<li>
							<a
								href={hrefFor(spec)}
								class={sameRange(spec, value)
									? 'font-semibold text-fg'
									: 'text-accent hover:underline'}
								aria-current={sameRange(spec, value) ? 'true' : undefined}
								data-sveltekit-reset="false"
								onclick={() => remember(spec)}>{rangeLabel(spec)}</a
							>
						</li>
					{/each}
				</ul>
			</div>

			<form
				class="space-y-1.5"
				onsubmit={(e) => {
					e.preventDefault();
					apply(validSpec({ key: 'custom', from: customFrom, to: customTo }), 'custom');
				}}
			>
				<div class="text-[11px] font-semibold tracking-wide text-muted uppercase">
					{t().range.customRange}
				</div>
				<div class="flex items-center gap-2">
					<input
						class="input h-8 min-w-0 flex-1"
						type="date"
						required
						aria-label={t().range.fromDate}
						max={customTo || undefined}
						bind:value={customFrom}
					/>
					<span class="text-muted">→</span>
					<input
						class="input h-8 min-w-0 flex-1"
						type="date"
						required
						aria-label={t().range.toDate}
						min={customFrom || undefined}
						bind:value={customTo}
					/>
					<button class="btn btn-primary h-8" type="submit">{t().common.apply}</button>
				</div>
				{#if tooLong === 'custom'}<p class="text-[12px] text-[var(--bad)]">
						{t().range.upTo(MAX_RANGE_DAYS)}
					</p>{/if}
			</form>

			<form
				class="space-y-1.5 border-t border-line pt-3"
				onsubmit={(e) => {
					e.preventDefault();
					setAuto(autoSec === refreshSec ? null : refreshSec);
				}}
			>
				<div class="text-[11px] font-semibold tracking-wide text-muted uppercase">
					{t().range.refreshEvery}
				</div>
				<div class="flex items-center gap-2">
					<input
						class="input h-8 w-16"
						type="number"
						min="1"
						max="999"
						required
						aria-label={t().range.refreshInterval}
						bind:value={refreshN}
					/>
					<select
						class="input h-8 flex-1"
						aria-label={t().range.refreshUnit}
						bind:value={refreshUnit}
					>
						<option value="s">{t().range.seconds}</option>
						<option value="m">{t().range.minutes}</option>
						<option value="h">{t().range.hours}</option>
					</select>
					<button class="btn h-8 w-[5.5rem] justify-center" type="submit">
						{#if autoSec === refreshSec}<Pause size={14} />
							{t().range.stop}{:else}<Play size={14} /> {t().range.start}{/if}
					</button>
				</div>
				<p class="text-[12px] text-muted">
					{autoSec ? t().range.autoOn(short(autoSec)) : t().range.autoOff(MIN_REFRESH)}
				</p>
			</form>
		</div>
	</details>
	<button
		class={['btn h-8 justify-center', autoSec ? 'px-2 text-accent' : 'w-8 p-0']}
		onclick={refresh}
		disabled={refreshing}
		aria-label={autoSec ? t().range.refreshAuto(short(autoSec)) : t().range.refresh}
		title={autoSec ? t().range.refreshAuto(short(autoSec)) : t().range.refresh}
	>
		<RotateCw size={14} class={refreshing ? 'animate-spin' : ''} />
		{#if autoSec}<span class="text-[12px] tabular-nums">{short(autoSec)}</span>{/if}
	</button>
</div>
