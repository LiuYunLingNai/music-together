// Some Android WebViews expose a valid innerHeight while resolving both 100%
// and 100vh to zero during edge-to-edge layout. Resolve the stage's height in
// CSS pixels before any renderer measures its canvas, and refresh on rotation.
export function updateStageViewport(fallbackWidth = 0, fallbackHeight = 0) {
  const width = window.innerWidth || fallbackWidth;
  const height = window.innerHeight || fallbackHeight;
  if (width <= 0 || height <= 0) return;
  document.documentElement.style.setProperty(
    "--folia-viewport-height",
    `${height}px`,
  );
}

updateStageViewport();
window.addEventListener("resize", () => updateStageViewport());
window.visualViewport?.addEventListener("resize", () => updateStageViewport());
