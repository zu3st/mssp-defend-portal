import { afterEach, describe, expect, it } from 'vitest';
import { en } from './en.ts';
import { de } from './de.ts';
import { negotiate, num, parseAcceptLanguage, setLocale } from './index.svelte.ts';
import { rangeLabel } from '#lib/range.ts';
import { componentLine, formatCpu, workflowLabel } from '#lib/ui.ts';

afterEach(() => setLocale('en'));

/** Every key path, with the kind of value (text or function). */
function shape(o: object, prefix = ''): string[] {
	return Object.entries(o).flatMap(([k, v]) =>
		v && typeof v === 'object' ? shape(v, `${prefix}${k}.`) : [`${prefix}${k}:${typeof v}`]
	);
}

describe('dictionaries', () => {
	it('German has exactly the English keys', () => {
		expect(shape(de).sort()).toEqual(shape(en).sort());
	});
});

describe('language negotiation', () => {
	it('picks the first supported language by preference', () => {
		expect(negotiate(parseAcceptLanguage('de-DE,de;q=0.9,en-US;q=0.8'))).toBe('de');
		expect(negotiate(parseAcceptLanguage('fr-FR, en;q=0.5, de;q=0.7'))).toBe('de');
		expect(negotiate(parseAcceptLanguage('en-GB'))).toBe('en');
	});

	it('falls back to English', () => {
		expect(negotiate(parseAcceptLanguage(null))).toBe('en');
		expect(negotiate(parseAcceptLanguage('fr, de;q=0'))).toBe('en');
		expect(negotiate(['nl-NL'])).toBe('en');
	});
});

describe('German formatting', () => {
	it('names ranges with the right article and plural', () => {
		setLocale('de');
		expect(rangeLabel({ key: '1h' })).toBe('Letzte Stunde');
		expect(rangeLabel({ key: '1y' })).toBe('Letztes Jahr');
		expect(rangeLabel({ key: '7d' })).toBe('Letzte 7 Tage');
		expect(rangeLabel({ key: 'today' })).toBe('Heute');
		expect(rangeLabel({ key: 'custom', from: '2026-10-01', to: '2026-10-01' })).toBe('01.10.2026');
	});

	it('switches labels and numbers with the language', () => {
		expect(workflowLabel.acknowledged.label).toBe('Acknowledged');
		setLocale('de');
		expect(workflowLabel.acknowledged.label).toBe('Bestätigt');
		expect(num(12345)).toBe('12.345');
		expect(formatCpu(3.5)).toBe('3,50 %');
		expect(componentLine('DEGRADED', 'Degraded: kernel driver failed to load')).toBe(
			'Beeinträchtigt · kernel driver failed to load'
		);
	});
});
