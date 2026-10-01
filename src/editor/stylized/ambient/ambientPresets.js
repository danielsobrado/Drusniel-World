/**
 * The ambient layer is tuned per grass-test preset (sunny, goldenHour, rainy,
 * windy, calm, bowed, moonlight). This world has times of day (sky presets)
 * and weather modes instead; weather wins where it has a preset of its own.
 */
const BY_SKY_PRESET = Object.freeze({
  configured: 'sunny',
  // The donor's own look, which it ships under goldenHour.
  meadow: 'goldenHour',
  highfield: 'sunny',
  emberfall: 'goldenHour',
  stillmeadow: 'calm',
  galewind: 'windy',
  lowsway: 'bowed',
  moonrise: 'moonlight',
});

const BY_WEATHER = Object.freeze({
  rain: 'rainy',
  storm: 'rainy',
  wind: 'windy',
  sandstorm: 'windy',
});

export function ambientPresetName({ skyPreset, weatherMode, night = false }) {
  if (night) return 'moonlight';
  return BY_WEATHER[weatherMode] ?? BY_SKY_PRESET[skyPreset] ?? 'sunny';
}
