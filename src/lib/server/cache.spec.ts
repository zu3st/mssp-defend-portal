import { describe, expect, it } from 'vitest';
import { concurrency, TtlCache } from './cache';

function clock() {
	const c = { t: 0, now: () => c.t };
	return c;
}

describe('TtlCache', () => {
	it('keeps a value for its TTL, counted from when it arrived', async () => {
		const c = clock();
		const cache = new TtlCache(10, c.now);
		let calls = 0;
		const load = async () => ++calls;
		expect(await cache.get('k', 1000, load)).toBe(1);
		c.t = 999;
		expect(await cache.get('k', 1000, load)).toBe(1);
		c.t = 1000;
		expect(await cache.get('k', 1000, load)).toBe(2);
	});

	it('shares a load that is still running', async () => {
		const cache = new TtlCache();
		let calls = 0;
		let finish!: (v: number) => void;
		const load = () => (calls++, new Promise<number>((r) => (finish = r)));
		const a = cache.get('k', 0, load);
		const b = cache.get('k', 0, load);
		finish(7);
		expect([await a, await b]).toEqual([7, 7]);
		expect(calls).toBe(1);
		// TTL 0: shared while loading, never kept afterwards.
		await cache.get('k', 0, async () => 8);
		expect(calls).toBe(1);
	});

	it('forgets failures unless told to keep them', async () => {
		const c = clock();
		const cache = new TtlCache(10, c.now);
		let calls = 0;
		const failing = async () => {
			calls++;
			throw new Error('down');
		};
		await expect(cache.get('a', 1000, failing)).rejects.toThrow('down');
		await expect(cache.get('a', 1000, failing)).rejects.toThrow('down');
		expect(calls).toBe(2);

		await expect(cache.get('b', 1000, failing, 500)).rejects.toThrow('down');
		await expect(cache.get('b', 1000, failing, 500)).rejects.toThrow('down');
		expect(calls).toBe(3);
		c.t = 500;
		await expect(cache.get('b', 1000, failing, 500)).rejects.toThrow('down');
		expect(calls).toBe(4);
	});

	it('drops the oldest key when full', async () => {
		const cache = new TtlCache(2);
		let calls = 0;
		const load = async () => ++calls;
		await cache.get('a', 1e6, load);
		await cache.get('b', 1e6, load);
		await cache.get('c', 1e6, load);
		await cache.get('b', 1e6, load);
		expect(calls).toBe(3);
		await cache.get('a', 1e6, load);
		expect(calls).toBe(4);
	});
});

describe('concurrency', () => {
	it('runs at most n tasks at once and finishes them all', async () => {
		const limit = concurrency(2);
		let running = 0;
		let peak = 0;
		const task = async (i: number) => {
			running++;
			peak = Math.max(peak, running);
			await new Promise((r) => setTimeout(r, 1));
			running--;
			if (i === 3) throw new Error('one fails');
			return i;
		};
		const results = await Promise.allSettled([0, 1, 2, 3, 4, 5].map((i) => limit(() => task(i))));
		expect(peak).toBe(2);
		expect(results.map((r) => r.status)).toEqual([
			'fulfilled',
			'fulfilled',
			'fulfilled',
			'rejected',
			'fulfilled',
			'fulfilled'
		]);
	});
});
