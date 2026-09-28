/** How often the numbers change: often enough to follow, slow enough to read. */
const REFRESH_MS = 500;

function formatCount(value) {
  return Math.round(value).toLocaleString('en-US');
}

/**
 * The renderer's totals for the last *finished* frame. The animation loop resets
 * `info` before the frame callback runs, so anything read from inside the loop
 * sees the new frame's zeros; the totals are snapshotted as `reset` clears them.
 */
function snapshotOnReset(renderer) {
  const info = renderer?.info;
  if (!info || info.__hudSnapshot) return info?.__hudSnapshot ?? null;
  const snapshot = { triangles: 0, draws: 0 };
  const reset = info.reset.bind(info);
  info.reset = () => {
    snapshot.triangles = info.render.triangles;
    snapshot.draws = info.render.drawCalls ?? info.render.calls;
    reset();
  };
  info.__hudSnapshot = snapshot;
  return snapshot;
}

/**
 * Frame-rate and scene-cost readout beside the minimap, after grass-test's
 * cinematic metrics line: `FPS 143  TRIS 4,588,958  DRAWS 94`.
 *
 * Frames are counted from `update` calls, which run once per rendered frame while
 * walking, and averaged over the refresh window; triangles and draws are the
 * last finished frame's (see `snapshotOnReset`).
 */
export class HudMetrics {
  /**
   * @param {object} options
   * @param {() => object | null} options.getRenderer the WebGPU renderer
   */
  constructor({ getRenderer }) {
    this.getRenderer = getRenderer;
    this.element = document.createElement('section');
    this.element.className = 'hud-metrics';
    this.element.hidden = true;
    this.element.setAttribute('aria-hidden', 'true');
    this.element.innerHTML = `
      <span>FPS <strong data-metric="fps">—</strong></span>
      <span>TRIS <strong data-metric="tris">—</strong></span>
      <span>DRAWS <strong data-metric="draws">—</strong></span>
    `;
    this.fields = {
      fps: this.element.querySelector('[data-metric="fps"]'),
      tris: this.element.querySelector('[data-metric="tris"]'),
      draws: this.element.querySelector('[data-metric="draws"]'),
    };
    this.windowStart = null;
    this.frames = 0;
    this.shown = {};
  }

  setVisible(visible) {
    this.element.hidden = !visible;
    if (!visible) this.windowStart = null;
  }

  update(nowMs) {
    if (this.element.hidden) return;
    if (this.windowStart === null) {
      this.windowStart = nowMs;
      this.frames = 0;
      return;
    }
    this.frames += 1;
    const elapsed = nowMs - this.windowStart;
    if (elapsed < REFRESH_MS) return;
    const last = snapshotOnReset(this.getRenderer?.());
    this.write('fps', String(Math.round((this.frames * 1000) / elapsed)));
    if (last) {
      this.write('tris', formatCount(last.triangles));
      this.write('draws', formatCount(last.draws));
    }
    this.windowStart = nowMs;
    this.frames = 0;
  }

  write(field, text) {
    if (this.shown[field] === text) return;
    this.shown[field] = text;
    this.fields[field].textContent = text;
  }

  dispose() {
    this.element.remove();
  }
}
