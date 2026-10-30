<script lang="ts">
	import { enhance } from '$app/forms';
	import { ShieldCheck } from '@lucide/svelte';
	import { t } from '#lib/i18n/index.svelte.ts';
	import type { PageProps } from './$types';

	let { form, data }: PageProps = $props();
	let busy = $state(false);
</script>

<svelte:head><title>{t().auth.signIn} · {data.tenantName}</title></svelte:head>

<div class="flex min-h-dvh items-center justify-center p-4">
	<form
		method="POST"
		class="card w-full max-w-sm space-y-4 p-6"
		use:enhance={() => {
			busy = true;
			return async ({ update }) => {
				await update();
				busy = false;
			};
		}}
	>
		<div class="flex items-center gap-2.5">
			<ShieldCheck size={22} class="text-accent" />
			<div>
				<div class="font-semibold">{t().app.name}</div>
				<div class="text-[12px] text-muted">{data.tenantName}</div>
			</div>
		</div>
		{#if form?.message}
			<div
				class="rounded-md bg-[var(--bad-bg)] px-3 py-2 text-[13px] text-[var(--bad)]"
				role="alert"
			>
				{form.message}
			</div>
		{/if}
		<label class="block space-y-1">
			<span class="text-[13px] text-muted">{t().auth.username}</span>
			<input
				class="input w-full"
				name="username"
				autocomplete="username"
				required
				value={form?.username ?? ''}
			/>
		</label>
		<label class="block space-y-1">
			<span class="text-[13px] text-muted">{t().auth.password}</span>
			<input
				class="input w-full"
				type="password"
				name="password"
				autocomplete="current-password"
				required
			/>
		</label>
		<button class="btn btn-primary w-full justify-center" disabled={busy}
			>{busy ? t().auth.signingIn : t().auth.signIn}</button
		>
	</form>
</div>
