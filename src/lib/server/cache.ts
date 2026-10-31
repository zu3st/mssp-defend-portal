/**
 * In-memory cache for Elastic responses that change slowly, per container.
 *
 * - Requests for a key that is already loading share that load (single
 *   flight), so tabs refreshing at the same moment cost one backend call.
 * - Freshness counts from when the value arrived.
 * - Failures are dropped, or kept for `errorTtlMs`: best-effort lookups set it
 *   so a broken endpoint is retried once per interval.
 * - At most `maxEntries` keys; the oldest goes first.
 */
interface Entry {
	value: Promise<unknown>;
	pending: boolean;
	at: number;
	ttl: number;
}

export class TtlCache {
	private entries = new Map<string, Entry>();
	constructor(
		private maxEntries = 500,
		private now = () => Date.now()
	) {}

	get<T>(key: string, ttlMs: number, load: () => Promise<T>, errorTtlMs = 0): Promise<T> {
		const hit = this.entries.get(key);
		if (hit && (hit.pending || this.now() - hit.at < hit.ttl)) return hit.value as Promise<T>;

		const value = load();
		const entry: Entry = { value, pending: true, at: this.now(), ttl: ttlMs };
		this.entries.delete(key);
		this.entries.set(key, entry);
		if (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value!);
		value.then(
			() => {
				entry.pending = false;
				entry.at = this.now();
			},
			() => {
				entry.pending = false;
				entry.at = this.now();
				entry.ttl = errorTtlMs;
				if (!errorTtlMs && this.entries.get(key) === entry) this.entries.delete(key);
			}
		);
		return value;
	}
}

/** Runs at most `n` tasks at once; the others wait their turn. */
export function concurrency(n: number) {
	let running = 0;
	const waiting: (() => void)[] = [];
	return async <T>(task: () => Promise<T>): Promise<T> => {
		if (running < n) running++;
		else await new Promise<void>((resolve) => waiting.push(resolve));
		try {
			return await task();
		} finally {
			// Hand the slot straight to the next task, or give it back.
			const next = waiting.shift();
			if (next) next();
			else running--;
		}
	};
}
