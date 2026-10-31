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
	/* A wide band with eased stops, so the light rises and falls gently across the dots. */
	.ring {
		position: absolute;
		left: 50%;
		top: 50%;
		width: 110cqmax;
		aspect-ratio: 1;
		margin: -55cqmax 0 0 -55cqmax;
		/* Round, so GPUs that draw a scaled layer's edge show no square through the dots. */
		border-radius: 50%;
		background: radial-gradient(
			circle closest-side,
			transparent 18%,
			color-mix(in srgb, var(--backdrop-wave) 4%, transparent) 28%,
			color-mix(in srgb, var(--backdrop-wave) 14%, transparent) 36%,
			color-mix(in srgb, var(--backdrop-wave) 32%, transparent) 44%,
			color-mix(in srgb, var(--backdrop-wave) 58%, transparent) 51%,
			color-mix(in srgb, var(--backdrop-wave) 84%, transparent) 57%,
			var(--backdrop-wave) 62%,
			color-mix(in srgb, var(--backdrop-wave) 84%, transparent) 67%,
			color-mix(in srgb, var(--backdrop-wave) 58%, transparent) 73%,
			color-mix(in srgb, var(--backdrop-wave) 32%, transparent) 80%,
			color-mix(in srgb, var(--backdrop-wave) 14%, transparent) 87%,
			color-mix(in srgb, var(--backdrop-wave) 4%, transparent) 94%,
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
			transform: scale(1.4);
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
