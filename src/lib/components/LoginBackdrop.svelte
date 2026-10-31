<!--
	Background of the sign-in page: a still dot grid that lights up as invisible
	rings spread from the centre, a new one every 7 seconds.

	Three layers, bottom to top: the dot colour (fading toward the edges), the
	rings of light, and a still cover in the page colour with a hole at every
	dot. The rings show only through the holes. Only the rings move, by
	transform and opacity, so the browser never repaints while it runs.
-->
<div class="backdrop" aria-hidden="true">
	<div class="dots"></div>
	{#each [0, 7, 14] as offset (offset)}
		<div class="ring" style:animation-delay="-{offset}s"></div>
	{/each}
	<div class="cover"></div>
</div>

<style>
	.backdrop {
		position: absolute;
		inset: 0;
		z-index: -1;
		overflow: hidden;
		pointer-events: none;
		container-type: size;
	}
	.dots,
	.cover {
		position: absolute;
		inset: 0;
	}
	.dots {
		background: radial-gradient(
			ellipse 75% 75% at center,
			var(--backdrop-dot) 30%,
			color-mix(in srgb, var(--backdrop-dot) 55%, transparent) 60%,
			color-mix(in srgb, var(--backdrop-dot) 15%, transparent) 85%,
			transparent
		);
	}
	/* Eased stops: a straight fade to transparent leaves a visible rim. */
	.ring {
		position: absolute;
		left: 50%;
		top: 50%;
		width: 110cqmax;
		aspect-ratio: 1;
		margin: -55cqmax 0 0 -55cqmax;
		background: radial-gradient(
			circle closest-side,
			transparent 58%,
			color-mix(in srgb, var(--backdrop-wave) 15%, transparent) 68%,
			color-mix(in srgb, var(--backdrop-wave) 60%, transparent) 76%,
			var(--backdrop-wave) 82%,
			color-mix(in srgb, var(--backdrop-wave) 55%, transparent) 89%,
			color-mix(in srgb, var(--backdrop-wave) 12%, transparent) 95%,
			transparent
		);
		opacity: 0;
		transform: scale(0.15);
		animation: spread 21s infinite;
	}
	@keyframes spread {
		0% {
			transform: scale(0.15);
			opacity: 0;
			animation-timing-function: cubic-bezier(0.3, 0.25, 0.6, 1);
		}
		8% {
			opacity: 1;
		}
		100% {
			transform: scale(1.2);
			opacity: 0;
		}
	}
	.cover {
		background-image: radial-gradient(circle, transparent 1.25px, var(--canvas) 1.9px);
		background-size: 28px 28px;
		background-position: center;
	}
	@media (prefers-reduced-motion: reduce) {
		.ring {
			animation: none;
		}
	}
</style>
