import { de } from './de.ts';
import { en, type Messages } from './en.ts';

/**
 * UI language. The server picks it per request (the `lang` cookie, else the
 * browser's Accept-Language) and the root layout sets it before anything
 * renders; server-side rendering is synchronous, so requests never see each
 * other's language. In the browser it is reactive, so switching language
 * re-renders without a reload.
 */
export const LOCALES = ['en', 'de'] as const;
export type Locale = (typeof LOCALES)[number];

export const LOCALE_COOKIE = 'lang';
/** Language names, always in their own language. */
export const LOCALE_NAMES: Record<Locale, string> = { en: 'English', de: 'Deutsch' };
/** Tags for Intl formatting: English keeps day-month-year dates. */
export const INTL_TAG: Record<Locale, string> = { en: 'en-GB', de: 'de-DE' };

const DICTS: Record<Locale, Messages> = { en, de };
const current = $state({ locale: 'en' as Locale });

export const isLocale = (v: unknown): v is Locale => LOCALES.includes(v as Locale);
export const locale = (): Locale => current.locale;
export const setLocale = (l: Locale) => (current.locale = l);
/** Strings in the current language. */
export const t = (): Messages => DICTS[current.locale];
/** Strings in a given language, for server code that answers one request. */
export const messages = (l: Locale | undefined): Messages => DICTS[l ?? 'en'];

/** First supported language in preference order (e.g. navigator.languages); English otherwise. */
export function negotiate(preferred: readonly string[]): Locale {
	for (const tag of preferred) {
		const primary = tag.trim().toLowerCase().split('-')[0];
		if (isLocale(primary)) return primary;
	}
	return 'en';
}

/** Accept-Language header to tags in preference order. */
export function parseAcceptLanguage(header: string | null): string[] {
	if (!header) return [];
	return header
		.split(',')
		.map((part, i) => {
			const [tag, ...params] = part.trim().split(';');
			const q = params.map((p) => /^\s*q=([\d.]+)\s*$/.exec(p)?.[1]).find(Boolean);
			return { tag, q: q === undefined ? 1 : Number(q), i };
		})
		.filter((x) => x.tag && x.q > 0)
		.sort((a, b) => b.q - a.q || a.i - b.i)
		.map((x) => x.tag);
}

const numberFormats = new Map<Locale, Intl.NumberFormat>();
/** A count in the current language's digit grouping (1,234 / 1.234). */
export function num(n: number): string {
	let f = numberFormats.get(current.locale);
	if (!f) numberFormats.set(current.locale, (f = new Intl.NumberFormat(INTL_TAG[current.locale])));
	return f.format(n);
}
