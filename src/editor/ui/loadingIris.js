/** Seconds for the iris to open across the screen (the donor's IRIS_OPEN_SECONDS). */
const OPEN_SECONDS = 0.9;
/** Far enough that the circle clears every corner of any aspect ratio. */
const OPEN_RADIUS_VMAX = 150;

function power4InOut(t) {
  return t < 0.5 ? 8 * t ** 4 : 1 - ((-2 * t + 2) ** 4) / 2;
}

function prefersReducedMotion() {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/**
 * Opens a circle in the middle of `element` until it clears the screen, after
 * grass-test's loading reveal: the world appears through a widening iris rather
 * than under a fade. The element's CSS masks itself with `--iris` (see
 * loadingOverlay.css); this only animates that radius.
 *
 * @param {HTMLElement} element
 * @returns {{ done: Promise<void>, cancel: () => void }}
 */
export function openIris(element) {
  let frame = 0;
  let finish = () => {};
  const done = new Promise((resolve) => { finish = resolve; });
  if (prefersReducedMotion() || typeof requestAnimationFrame !== 'function') {
    finish();
    return { done, cancel() {} };
  }
  const startedAt = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - startedAt) / (OPEN_SECONDS * 1000));
    element.style.setProperty('--iris', `${(power4InOut(t) * OPEN_RADIUS_VMAX).toFixed(2)}vmax`);
    if (t < 1) frame = requestAnimationFrame(step);
    else finish();
  };
  frame = requestAnimationFrame(step);
  return {
    done,
    cancel() {
      cancelAnimationFrame(frame);
      finish();
    },
  };
}
