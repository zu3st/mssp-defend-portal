import { pushState } from '$app/navigation';
import { page } from '$app/state';

/**
 * Alert side-panel selection uses shallow routing: the id is mirrored into
 * `?alert=<id>` (linkable, back button closes the panel) and carried in
 * `page.state`, so the page's list load does not re-run.
 */
export function selectAlert(id: string | null) {
	const u = new URL(location.href);
	if (id) u.searchParams.set('alert', id);
	else u.searchParams.delete('alert');
	pushState(u.pathname + u.search, { alert: id });
}

/** Current selection: shallow state first, then the URL on a fresh load. */
export function selectedAlert(): string | null {
	return page.state.alert !== undefined ? page.state.alert : page.url.searchParams.get('alert');
}
