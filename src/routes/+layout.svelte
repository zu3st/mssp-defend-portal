<script lang="ts">
	import './layout.css';
	import { page, navigating } from '$app/state';
	import { invalidateAll } from '$app/navigation';
	import type { LayoutProps } from './$types';
	import TimePicker from '#lib/components/TimePicker.svelte';
	import {
		LayoutDashboard,
		LogOut,
		Menu,
		Moon,
		Server,
		ShieldAlert,
		ShieldCheck,
		Sun,
		SunMoon
	} from '@lucide/svelte';

	let { children, data }: LayoutProps = $props();

	const nav = [
		{ href: '/', label: 'Overview', icon: LayoutDashboard },
		{ href: '/detections', label: 'Detections', icon: ShieldAlert },
		{ href: '/agents', label: 'Agents', icon: Server }
	];

	const isActive = (href: string) =>
		href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(href);

	type Theme = 'system' | 'light' | 'dark';
	let theme: Theme = $state('system');
	let mobileNav = $state(false);

	// Calendar ranges ("Today", "This week", custom dates) follow the browser's
	// time zone; the server learns it from this cookie.
	$effect(() => {
		const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
		if (!tz || document.cookie.includes(`tz=${encodeURIComponent(tz)}`)) return;
		document.cookie = `tz=${encodeURIComponent(tz)}; path=/; max-age=31536000; samesite=lax`;
		if (page.data.timeRange) invalidateAll();
	});

	$effect(() => {
		const c = document.documentElement.classList;
		theme = c.contains('dark') ? 'dark' : c.contains('light') ? 'light' : 'system';
	});

	function cycleTheme() {
		theme = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system';
		const c = document.documentElement.classList;
		c.remove('light', 'dark');
		if (theme !== 'system') c.add(theme);
		document.cookie =
			theme === 'system'
				? 'theme=; path=/; max-age=0; samesite=lax'
				: `theme=${theme}; path=/; max-age=31536000; samesite=lax`;
	}

	const pageTitle = $derived(nav.find((n) => isActive(n.href))?.label ?? '');
</script>

<svelte:head>
	<title>{pageTitle ? `${pageTitle} · ` : ''}{data.tenantName} · Security Portal</title>
	<link rel="icon" href="/favicon.svg" />
</svelte:head>

{#if !data.user}
	{@render children()}
{:else}
	<div class="flex min-h-dvh">
		<aside
			class="fixed inset-y-0 left-0 z-30 flex w-56 flex-col border-r border-line bg-surface transition-transform md:translate-x-0"
			class:-translate-x-full={!mobileNav}
		>
			<div class="flex h-14 items-center gap-2 border-b border-line px-4">
				<ShieldCheck size={20} class="text-accent" />
				<div class="leading-tight">
					<div class="text-[13px] font-semibold">Security Portal</div>
					<div class="max-w-40 truncate text-[11px] text-muted">{data.tenantName}</div>
				</div>
			</div>
			<nav class="flex-1 space-y-0.5 p-2">
				{#each nav as n (n.href)}
					<a
						href={n.href}
						onclick={() => (mobileNav = false)}
						class="flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium hover:bg-surface-2"
						class:bg-surface-2={isActive(n.href)}
						class:text-muted={!isActive(n.href)}
						aria-current={isActive(n.href) ? 'page' : undefined}
					>
						<n.icon size={16} />
						{n.label}
					</a>
				{/each}
			</nav>
		</aside>
		{#if mobileNav}
			<button
				class="fixed inset-0 z-20 bg-black/30 md:hidden"
				aria-label="Close menu"
				onclick={() => (mobileNav = false)}
			></button>
		{/if}

		<div class="flex min-w-0 flex-1 flex-col md:pl-56">
			<header
				class="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-line bg-surface/90 px-4 backdrop-blur"
			>
				<button
					class="btn h-8 w-8 justify-center p-0 md:hidden"
					aria-label="Open menu"
					onclick={() => (mobileNav = true)}
				>
					<Menu size={16} />
				</button>
				<!-- On the narrowest phones the date picker needs the title's room; the nav names the page. -->
				<h1 class={['text-[15px] font-semibold', page.data.timeRange && 'max-[379px]:sr-only']}>
					{pageTitle}
				</h1>
				{#if navigating.to}
					<span class="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" aria-label="Loading"
					></span>
				{/if}
				<div class="ml-auto flex items-center gap-1.5 sm:gap-2">
					<!-- Pages whose data covers a time range get Kibana's date picker, top right. -->
					{#if page.data.timeRange}
						<TimePicker
							value={page.data.timeRange.spec}
							from={page.data.timeRange.from}
							to={page.data.timeRange.to}
						/>
						<span class="mx-1 hidden h-5 w-px bg-[var(--line)] sm:block" aria-hidden="true"></span>
					{/if}
					<button
						class="btn h-8 w-8 justify-center p-0"
						onclick={cycleTheme}
						aria-label={`Theme: ${theme}`}
						title={`Theme: ${theme}`}
					>
						{#if theme === 'dark'}<Moon size={15} />{:else if theme === 'light'}<Sun
								size={15}
							/>{:else}<SunMoon size={15} />{/if}
					</button>
					<span class="hidden text-[13px] text-muted sm:inline">{data.user}</span>
					<form method="POST" action="/logout">
						<button class="btn h-8 w-8 justify-center p-0" aria-label="Sign out" title="Sign out"
							><LogOut size={15} /></button
						>
					</form>
				</div>
			</header>
			<main class="mx-auto w-full max-w-[1600px] flex-1 p-4 md:p-6">
				{@render children()}
			</main>
		</div>
	</div>
{/if}
