<script lang="ts">
	import LoginBackdrop from '#lib/components/LoginBackdrop.svelte';
	import { ArrowRight, ShieldCheck } from '@lucide/svelte';
	import { t } from '#lib/i18n/index.svelte.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head><title>{t().auth.signIn} · {data.tenantName}</title></svelte:head>

<div class="relative isolate flex min-h-dvh items-center justify-center p-4">
	<LoginBackdrop />
	<div class="card w-full max-w-sm space-y-5 p-6">
		<div class="flex items-center gap-2.5">
			<ShieldCheck size={22} class="text-accent" />
			<div>
				<div class="font-semibold">{t().app.name}</div>
				<div class="text-[12px] text-muted">{data.tenantName}</div>
			</div>
		</div>
		{#if data.error}
			<div
				class="rounded-md bg-[var(--bad-bg)] px-3 py-2 text-[13px] text-[var(--bad)]"
				role="alert"
			>
				{t().auth[data.error]}
			</div>
		{/if}
		<a
			class="btn btn-primary group h-10 w-full justify-center text-[14px]"
			href="/auth/login?next={encodeURIComponent(data.next)}"
			data-sveltekit-reload
		>
			{t().auth.signIn}
			<ArrowRight size={16} class="transition-transform group-hover:translate-x-0.5" />
		</a>
		<p class="text-center text-[12px] text-muted">{t().auth.signInHint}</p>
	</div>
</div>
