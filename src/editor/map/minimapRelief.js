/**
 * Relief shading for the minimap, after grass-test's baked world map
 * (`ui/minimapBake.js`): land is lit from the north-west as on a printed relief
 * map, so hills, ridges and valleys read from their shape instead of from how
 * high they happen to be; faint contour lines every `contourInterval` metres give
 * slopes a grain; the biome colours are settled toward their own luminance so the
 * map reads as terrain rather than as a legend. Water stays flat.
 *
 * Pure: the editor samples one height grid per redraw and hands its neighbours in.
 */

function normalize(vector) {
  const length = Math.hypot(...vector);
  return vector.map((value) => value / length);
}

/** Up-left of the bitmap, the way relief maps are lit. */
const LIGHT = Object.freeze(normalize([-0.55, 0.62, -0.55]));
/** The donor's shade range: shadowed slopes at 0.62, lit ones up to 1.12. */
const SHADE_BASE = 0.62;
const SHADE_LIGHT = 0.5;
const CONTOUR_STRENGTH = 0.1;
const SETTLE = 0.18;

function clamp01(value) {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function smoothstep(edge0, edge1, value) {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/**
 * How lit a land pixel is, from its four neighbours' heights.
 *
 * @param {object} heights metres: `left`, `right`, `up`, `down` in bitmap space
 * @param {number} spacing metres between neighbouring samples
 * @param {number} [exaggeration] vertical scale for gentle worlds
 */
export function reliefShade({ left, right, up, down }, spacing, exaggeration = 1) {
  const dx = (left - right) * exaggeration;
  const dz = (up - down) * exaggeration;
  const vertical = spacing * 2;
  const length = Math.hypot(dx, vertical, dz) || 1;
  const light = Math.max(0, (dx * LIGHT[0] + vertical * LIGHT[1] + dz * LIGHT[2]) / length);
  return SHADE_BASE + light * SHADE_LIGHT;
}

/** 0 between contours, up to CONTOUR_STRENGTH on a line. */
export function contourDarkening(height, interval) {
  if (!(interval > 0) || !Number.isFinite(height)) return 0;
  const band = Math.abs((((height / interval) % 1) + 1) % 1 - 0.5) * 2;
  return smoothstep(0.9, 0.98, band) * CONTOUR_STRENGTH;
}

/**
 * The shaded colour of one minimap pixel.
 *
 * @param {number[]} rgb 0..255 biome colour
 * @param {object} options
 * @param {boolean} options.water flat, no relief
 * @param {number} options.height metres
 * @param {object} options.neighbours see `reliefShade`
 * @param {number} options.spacing metres between samples
 * @param {number} [options.contourInterval] metres
 * @param {number} [options.exaggeration]
 * @returns {number[]} 0..255
 */
export function shadeMinimapPixel(rgb, { water, height, neighbours, spacing, contourInterval = 20, exaggeration = 1 }) {
  const luminance = rgb[0] * 0.3 + rgb[1] * 0.59 + rgb[2] * 0.11;
  const settled = rgb.map((channel) => channel + (luminance - channel) * SETTLE);
  if (water) return settled.map((channel) => Math.round(channel * 0.92));
  const shade = reliefShade(neighbours, spacing, exaggeration) * (1 - contourDarkening(height, contourInterval));
  return settled.map((channel) => Math.max(0, Math.min(255, Math.round(channel * shade))));
}
