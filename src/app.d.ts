// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
	namespace App {
		interface Locals {
			/** Authenticated portal user, if any. Tenant is fixed per container. */
			user?: string;
			tenantName: string;
			/** UI language of this request. */
			locale: import('#lib/i18n/index.svelte.ts').Locale;
		}
		interface PageState {
			/** Alert shown in the side panel (shallow routing). */
			alert?: string | null;
		}
	}
}

export {};
