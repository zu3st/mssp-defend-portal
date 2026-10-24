/**
 * Closes a `<details>` popover (filter dropdowns, row menus) when the user
 * clicks anywhere outside it. Usage: `<details use:closeOnOutsideClick>`.
 * Capture phase, so clicks inside elements that stop propagation (another row
 * menu) still close this one.
 */
export function closeOnOutsideClick(el: HTMLDetailsElement) {
	// Marks it as a popover, so auto-refresh waits while one is open.
	el.dataset.popover = '';
	function onClick(e: MouseEvent) {
		if (el.open && !el.contains(e.target as Node)) el.open = false;
	}
	window.addEventListener('click', onClick, true);
	return { destroy: () => window.removeEventListener('click', onClick, true) };
}
