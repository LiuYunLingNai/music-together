/** Apple-style easing: fast launch, graceful deceleration */
export const SPRING = { type: 'spring' as const, duration: 0.8, bounce: 0.06 }

/** Shared layout transition for the cover-art FLIP animation. */
export const LAYOUT_TRANSITION = { layout: SPRING }

/** Text moves slightly faster than the cover and avoids layout-heavy font-size springs. */
export const SONG_INFO_TRANSITION = {
  layout: { type: 'tween' as const, duration: 0.7, ease: [0.22, 1, 0.36, 1] as const },
}
