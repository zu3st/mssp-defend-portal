import { invalidateAll } from '$app/navigation';

/**
 * Re-runs the current page's loads every `ms`, like Kibana's auto-refresh.
 * A tick is skipped while the tab is hidden or the user is mid-interaction
 * (alert flyout, an open dropdown or menu, typing in a field), so nothing
 * moves under them. Returns the cleanup for `$effect`.
 */
export function startAutoRefresh(ms: number): () => void {
	let running = false;
	const id = setInterval(async () => {
		if (running || document.hidden || interacting()) return;
		running = true;
		try {
			await invalidateAll();
		} finally {
			running = false;
		}
	}, ms);
	return () => clearInterval(id);
}

function interacting(): boolean {
	if (document.querySelector('dialog[open], details[data-popover][open]')) return true;
	const el = document.activeElement;
	return (
		(el instanceof HTMLInputElement && !['checkbox', 'radio'].includes(el.type)) ||
		el instanceof HTMLSelectElement
	);
}
