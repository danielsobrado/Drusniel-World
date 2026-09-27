import { HUD_PHASE } from './hudState.js';

/** The borrowed bitmap is drawn this much larger than the dial it shows through. */
const MAP_ZOOM = 1.7;
/**
 * How far the player may drift from the bitmap's centre, as a fraction of its
 * window, before it is redrawn around them. The dial stays covered at any
 * heading up to (MAP_ZOOM - 1) / (2 × MAP_ZOOM) ≈ 0.206, so this keeps a margin.
 */
const RECENTER_FRACTION = 0.17;
const HEADING_EPSILON = 0.002;
const OFFSET_EPSILON = 0.0004;
const PLACE_REFRESH_MS = 300;

const MARKUP = `
  <div class="hud-minimap__disc">
    <div class="hud-minimap__dial">
      <span class="hud-minimap__view"></span>
      <svg class="hud-minimap__player" style="color: var(--glade-cream)" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 2.5 17.2 13.4a5.6 5.6 0 1 1-10.4 0L12 2.5Z"/>
        <circle cx="12" cy="15.4" r="2" fill="currentColor" stroke="none"/>
      </svg>
    </div>
    <div class="hud-minimap__compass"><span class="hud-minimap__north">N</span></div>
  </div>
  <div class="hud-minimap__place" hidden><i class="hud-minimap__swatch"></i><span></span></div>
`;

/**
 * Heading-up minimap in the top-right corner while walking.
 *
 * It docks the editor's own minimap frame rather than drawing a second map:
 * EditorUi keeps rendering the bitmap and the settlement markers, and this
 * widget only frames it, keeps the player at the centre between redraws, and
 * hands the frame back when walking stops.
 *
 * The bitmap is drawn with cell z growing downwards, which is the world's
 * top-down view flipped (cell z runs towards -Z). The dial therefore mirrors
 * it back and turns it by the camera yaw, so what is on the player's left in
 * the world is on the left of the dial.
 */
export class HudMinimap {
  /**
   * @param {object} source
   * @param {HTMLElement | null} source.frame the editor's `.minimap-frame`
   * @param {() => { center: { x: number, z: number }, cells: number }} source.getWindow
   * @param {(cell: { x: number, z: number }) => void} source.recenter
   * @param {() => { x: number, z: number } | null} source.getFocusPoint fractional cell
   * @param {(cellX: number, cellZ: number) => { label: string, color: string } | null} [source.describeCell]
   */
  constructor({ frame = null, getWindow, recenter, getFocusPoint, describeCell = null }) {
    this.frame = frame;
    this.getWindow = getWindow;
    this.recenter = recenter;
    this.getFocusPoint = getFocusPoint;
    this.describeCell = describeCell;
    this.home = null;

    this.element = document.createElement('div');
    this.element.className = 'hud-minimap';
    this.element.hidden = true;
    this.element.setAttribute('aria-hidden', 'true');
    this.element.style.setProperty('--hud-map-zoom', String(MAP_ZOOM));
    this.element.innerHTML = MARKUP;
    this.dial = this.element.querySelector('.hud-minimap__dial');
    this.place = this.element.querySelector('.hud-minimap__place');
    this.placeSwatch = this.place.querySelector('.hud-minimap__swatch');
    this.placeLabel = this.place.querySelector('span');
    this.resetReadout();
  }

  render(phase) {
    const docked = phase === HUD_PHASE.walking && this.frame != null;
    this.element.hidden = !docked;
    if (docked) this.dock();
    else this.undock();
  }

  update(heading, nowMs) {
    if (!this.home) return;
    this.updateHeading(heading);
    const point = this.getFocusPoint?.();
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.z)) return;
    this.updateOffset(point);
    if (nowMs >= this.nextPlaceAt) {
      this.nextPlaceAt = nowMs + PLACE_REFRESH_MS;
      this.updatePlace(point);
    }
  }

  dock() {
    if (this.home) return;
    this.home = { parent: this.frame.parentNode, next: this.frame.nextSibling };
    this.dial.prepend(this.frame);
    this.resetReadout();
  }

  undock() {
    if (!this.home) return;
    const { parent, next } = this.home;
    this.home = null;
    if (!parent) {
      this.frame.remove();
      return;
    }
    parent.insertBefore(this.frame, next?.parentNode === parent ? next : null);
  }

  resetReadout() {
    this.heading = Number.NaN;
    this.offsetX = Number.NaN;
    this.offsetZ = Number.NaN;
    this.placeSignature = undefined;
    this.nextPlaceAt = 0;
  }

  updateHeading(heading) {
    if (!Number.isFinite(heading) || Math.abs(heading - this.heading) < HEADING_EPSILON) return;
    this.heading = heading;
    this.element.style.setProperty('--hud-heading', `${heading.toFixed(4)}rad`);
  }

  offsetFrom(point) {
    const window = this.getWindow();
    if (!window?.center || !(window.cells > 0)) return null;
    return {
      x: (point.x - window.center.x) / window.cells,
      z: (point.z - window.center.z) / window.cells,
    };
  }

  updateOffset(point) {
    let offset = this.offsetFrom(point);
    if (offset && Math.hypot(offset.x, offset.z) > RECENTER_FRACTION) {
      this.recenter({ x: Math.floor(point.x), z: Math.floor(point.z) });
      offset = this.offsetFrom(point);
    }
    if (!offset) return;
    if (Math.abs(offset.x - this.offsetX) < OFFSET_EPSILON
        && Math.abs(offset.z - this.offsetZ) < OFFSET_EPSILON) return;
    this.offsetX = offset.x;
    this.offsetZ = offset.z;
    this.element.style.setProperty('--hud-map-x', offset.x.toFixed(5));
    this.element.style.setProperty('--hud-map-z', offset.z.toFixed(5));
  }

  updatePlace(point) {
    const place = this.describeCell?.(Math.floor(point.x), Math.floor(point.z)) ?? null;
    const signature = place ? `${place.label}|${place.color}` : null;
    if (signature === this.placeSignature) return;
    this.placeSignature = signature;
    this.place.hidden = !place?.label;
    if (!place?.label) return;
    // Biome names come from the imported world, so they are set as text.
    this.placeLabel.textContent = place.label;
    this.placeSwatch.style.background = place.color ?? 'transparent';
  }

  dispose() {
    this.undock();
    this.element.remove();
  }
}
