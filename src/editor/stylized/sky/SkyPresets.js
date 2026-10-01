/**
 * Times of day for the sky (after grass-test's environment presets), each a
 * partial override of `stylizedSurface.sky`. `configured` is the sky exactly
 * as editor.config.yaml tunes it. Weather is not a preset: rain and storms
 * grey whichever look is active (see overcastSkyLook), so a rainy night stays
 * night.
 *
 * Sun angles are in degrees in the sky's own convention (directionFromAngles);
 * intensities are relative to the configured lights; `fogDensityScale`
 * multiplies the view-distance fog.
 */
export const SKY_PRESETS = Object.freeze({
  configured: Object.freeze({ label: 'Configured' }),
  // grass-test's shipped look (`presets.goldenHour` in cinematic-look.yaml): a
  // warm sun high enough (~57°) to light the meadow from above, a pale mint
  // horizon under a clear blue zenith, and a green-bounced ground light. The
  // donor's hemisphere light (0.95) and ambient fill (0.32) sum to the fill here.
  meadow: Object.freeze({
    label: 'Meadow (bright day)',
    sunElevation: 57,
    sunAzimuth: 235,
    lowColor: '#c5e7df',
    highColor: '#438ec5',
    sunGlowColor: '#ffe8ad',
    sunColor: '#fff0c9',
    directionalColor: '#fff0c9',
    directionalIntensity: 2.8,
    ambientIntensity: 1.3,
    groundLightColor: '#78945d',
    fogColor: '#a5ced3',
  }),
  // Building light after the Tiny Glade references (docs/reference/tiny-glade):
  // a warm, fairly high sun, bright warm bounce off the ground and a pale,
  // near-neutral sky light, so shaded stone stays light and warm and contrast
  // stays low.
  glade: Object.freeze({
    label: 'Glade (warm building light)',
    sunElevation: 38,
    sunAzimuth: 200,
    lowColor: '#f3dcbc',
    highColor: '#8ab4dc',
    sunGlowColor: '#ffd9a0',
    sunColor: '#fff3dc',
    sunGlowIntensity: 0.35,
    directionalColor: '#ffd29a',
    directionalIntensity: 3.9,
    ambientIntensity: 3.3,
    ambientSaturation: 0.04,
    groundLightColor: '#d3a86a',
    fogColor: '#e9d8bf',
  }),
  highfield: Object.freeze({
    label: 'Highfield (day)',
    sunElevation: 42,
    sunAzimuth: 235,
    lowColor: '#91d5ff',
    highColor: '#4174d9',
    sunGlowColor: '#ffd77d',
    sunColor: '#fff9dc',
    sunGlowIntensity: 0.3,
    directionalColor: '#ffe7b8',
    directionalIntensity: 3.2,
    ambientIntensity: 2.0,
    groundLightColor: '#6f784d',
    fogColor: '#a8cbd0',
  }),
  emberfall: Object.freeze({
    label: 'Emberfall (golden hour)',
    sunElevation: 7,
    sunAzimuth: 262,
    lowColor: '#ff9b5d',
    highColor: '#51437f',
    sunGlowColor: '#ffb35c',
    sunColor: '#fff0c0',
    sunGlowIntensity: 0.7,
    cloudCore: '#b98a86',
    cloudEdge: '#ffd2b0',
    cloudRim: '#ffb35c',
    directionalColor: '#ff9d4d',
    directionalIntensity: 2.6,
    ambientIntensity: 1.1,
    groundLightColor: '#4a2b20',
    fogColor: '#c88973',
  }),
  stillmeadow: Object.freeze({
    label: 'Stillmeadow (soft morning)',
    sunElevation: 26,
    sunAzimuth: 110,
    lowColor: '#b8dce1',
    highColor: '#6289b8',
    sunGlowColor: '#f5d18f',
    sunColor: '#fff7dc',
    directionalColor: '#ffd995',
    directionalIntensity: 2.4,
    ambientIntensity: 2.1,
    groundLightColor: '#5c4b31',
    fogColor: '#b7cfd0',
    fogDensityScale: 1.25,
  }),
  galewind: Object.freeze({
    label: 'Galewind (bright, windy)',
    sunElevation: 30,
    sunAzimuth: 200,
    lowColor: '#91d0e8',
    highColor: '#316fc5',
    sunGlowColor: '#ffd58b',
    sunColor: '#fffbe5',
    cloudDensity: 0.5,
    directionalColor: '#ffd990',
    directionalIntensity: 3.0,
    ambientIntensity: 1.7,
    groundLightColor: '#4a3d28',
    fogColor: '#a6c8cf',
  }),
  lowsway: Object.freeze({
    label: 'Lowsway (low sun)',
    sunElevation: 14,
    sunAzimuth: 250,
    lowColor: '#91d5ff',
    highColor: '#2864d8',
    sunGlowColor: '#ffd77d',
    sunColor: '#fff9dc',
    directionalColor: '#ffd27a',
    directionalIntensity: 3.0,
    ambientIntensity: 1.9,
    groundLightColor: '#51402a',
    fogColor: '#a8cbd0',
  }),
  moonrise: Object.freeze({
    label: 'Moonrise (night)',
    sunElevation: 24,
    sunAzimuth: 140,
    lowColor: '#526f8c',
    highColor: '#050b1c',
    sunGlowColor: '#9fc9ff',
    sunColor: '#ffffff',
    sunEmission: 1.1,
    sunGlowIntensity: 0.2,
    cloudCore: '#243247',
    cloudEdge: '#4a6384',
    cloudRim: '#9fc9ff',
    cloudOpacity: 0.5,
    directionalColor: '#8eafff',
    directionalIntensity: 0.9,
    ambientIntensity: 0.55,
    groundLightColor: '#151c1b',
    fogColor: '#263d52',
    cloudShadowStrength: 0.25,
    night: true,
  }),
});

/** The sky exactly as editor.config.yaml tunes it; applying it changes nothing. */
export const CONFIGURED_SKY_PRESET = 'configured';
export const DEFAULT_SKY_PRESET = 'meadow';
