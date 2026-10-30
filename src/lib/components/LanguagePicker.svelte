<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { closeOnOutsideClick } from '#lib/actions.ts';
	import {
		LOCALE_COOKIE,
		LOCALE_NAMES,
		LOCALES,
		locale,
		negotiate,
		setLocale,
		t,
		type LocalePref
	} from '#lib/i18n/index.svelte.ts';
	import { Check, Languages } from '@lucide/svelte';

	/**
	 * Language menu beside the theme toggle. "System" (the default) follows the
	 * browser's languages; a chosen language is kept in a cookie.
	 */
	let { pref }: { pref: LocalePref } = $props();

	let el: HTMLDetailsElement | undefined = $state();
	let chosen: LocalePref = $derived(pref);
	const OPTIONS: LocalePref[] = ['system', ...LOCALES];

	function choose(p: LocalePref) {
		chosen = p;
		document.cookie =
			p === 'system'
				? `${LOCALE_COOKIE}=; path=/; max-age=0; samesite=lax`
				: `${LOCALE_COOKIE}=${p}; path=/; max-age=31536000; samesite=lax`;
		const l = p === 'system' ? negotiate(navigator.languages) : p;
		setLocale(l);
		document.documentElement.lang = l;
		if (el) el.open = false;
		// Messages the server put in the page data (errors) follow too.
		invalidateAll();
	}
</script>

<details class="relative" bind:this={el} use:closeOnOutsideClick>
	<summary
		class="btn h-8 w-8 cursor-pointer list-none justify-center gap-1 p-0 sm:w-auto sm:px-2"
		aria-label={t().language.label}
		title={t().language.label}
	>
		<Languages size={15} />
		<!-- The code only where there is room; phones get the icon alone. -->
		<span class="hidden text-[11px] font-semibold uppercase sm:inline">{locale()}</span>
	</summary>
	<div class="card absolute top-full right-0 z-30 mt-1 min-w-36 p-1 text-[13px] shadow-lg">
		{#each OPTIONS as p (p)}
			<button
				type="button"
				class="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left hover:bg-surface-2"
				aria-pressed={chosen === p}
				onclick={() => choose(p)}
			>
				<Check size={14} class={chosen === p ? 'text-accent' : 'invisible'} />
				{p === 'system' ? t().language.system : LOCALE_NAMES[p]}
			</button>
		{/each}
	</div>
</details>
