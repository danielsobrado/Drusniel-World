/**
 * Blade silhouettes for the streamed grass field.
 *
 * A profile is a normalized blade outline: `halfWidth` in units of the blade's own
 * widest point, and `curve` — the centreline's drift from the base — in units of
 * blade length. Authored profiles are baked from the grass GLBs' texture alpha by
 * `scripts/extract-grass-blade-profiles.mjs`; those assets are alpha cards whose
 * meshes carry no shape at all, so lifting the outline offline is the only way to
 * get the authored silhouette onto a 5-triangle strip at field density.
 *
 * Profiles are resampled to whatever segment budget a band draws, so the near and
 * far blades share one manifest and changing `BLADE_SEGMENTS` needs no re-bake.
 */

export const GENERATED_PROFILE_ID = 'generated';

const GENERATED_SAMPLES = 17;

/**
 * The blade this system replaces: widest at the base, tapering to a point.
 * Retained because a set that names no authored profile has to draw something, and
 * because it is the baseline an authored set is judged against.
 */
export function generatedProfile() {
  const halfWidth = [];
  const curve = [];
  for (let i = 0; i < GENERATED_SAMPLES; i += 1) {
    const t = i / (GENERATED_SAMPLES - 1);
    halfWidth.push((1 - t) ** 1.2);
    curve.push(0);
  }
  return { id: GENERATED_PROFILE_ID, halfWidth, curve, aspect: 1 };
}

/**
 * The donor's silhouette families, as generated outlines rather than baked ones.
 *
 * These are profiles in the same sense as the extracted ones: a normalized outline
 * the 5-triangle strip already knows how to draw, so a biome can change what its
 * grass looks like without an asset, a material or a draw call. The donor's three
 * families are its whole shape vocabulary for blades — its fourth, `tufted`, is a
 * billboard family and has no near-band equivalent here, so it is deliberately not
 * among them.
 *
 * `width` is the donor's half-width at height ratio `r`, before its per-shape
 * scale; `widthScale` is that scale, and it is what makes a reed a reed. The donor
 * measured the fill cost of these: a shape may not go far past ~1.35x the baseline's
 * area, because grass is fill-bound long before it is triangle-bound, and every
 * shape here draws the same vertex count.
 */
const GENERATED_SHAPES = Object.freeze({
  slender: Object.freeze({ width: (r) => 1 - r, widthScale: 1 }),
  reed: Object.freeze({ width: (r) => 1 - r ** 5, widthScale: 0.55 }),
  broadleaf: Object.freeze({ width: (r) => Math.sqrt(Math.max(0, 1 - r * r)), widthScale: 0.85 }),
});

export const GENERATED_SHAPE_IDS = Object.freeze(Object.keys(GENERATED_SHAPES));

/**
 * A silhouette family as a profile, normalized so its widest point is 1 — the unit
 * the rest of this module works in — with the donor's scale kept alongside it, since
 * scaling the outline itself would move the widest point and change what "1" means.
 */
export function shapedProfile(id) {
  const shape = GENERATED_SHAPES[id];
  if (!shape) return null;
  const halfWidth = [];
  const curve = [];
  for (let i = 0; i < GENERATED_SAMPLES; i += 1) {
    const t = i / (GENERATED_SAMPLES - 1);
    halfWidth.push(shape.width(t));
    curve.push(0);
  }
  let peak = 0;
  for (const value of halfWidth) peak = Math.max(peak, value);
  return {
    id,
    halfWidth: halfWidth.map((value) => value / (peak || 1)),
    curve,
    widthScale: shape.widthScale,
    aspect: 1,
  };
}

/** Every generated shape, as profiles, in `GENERATED_SHAPE_IDS` order. */
export function shapedProfiles() {
  return GENERATED_SHAPE_IDS.map((id) => shapedProfile(id));
}

function sampleAt(values, t) {
  const last = values.length - 1;
  if (last <= 0) return values[0] ?? 0;
  const position = Math.min(last, Math.max(0, t * last));
  const low = Math.floor(position);
  const high = Math.min(last, low + 1);
  return values[low] + (values[high] - values[low]) * (position - low);
}

/**
 * Resamples a profile onto a band's vertex rows: one value per segment boundary
 * plus the tip. `halfWidth` at the tip index is never used for width — the tip is a
 * single vertex — but its `curve` is, because that is where the tip sits.
 */
export function resampleProfile(profile, segments) {
  const rows = Math.max(1, Math.round(segments)) + 1;
  const halfWidth = new Float64Array(rows);
  const curve = new Float64Array(rows);
  for (let row = 0; row < rows; row += 1) {
    const t = row / (rows - 1);
    halfWidth[row] = sampleAt(profile.halfWidth, t);
    curve[row] = sampleAt(profile.curve, t);
  }
  // Carried through the resample rather than read from the set later: which
  // silhouette a blade is wearing is decided per blade in the geometry loop, so the
  // scale has to travel with the shape it belongs to.
  return { id: profile.id, halfWidth, curve, widthScale: profile.widthScale ?? 1 };
}

/**
 * Resolves a configured set name against a baked manifest.
 *
 * An unknown or empty set falls back to the generated taper rather than throwing:
 * the manifest is a build artifact, and a field of blades is a better failure than
 * a blank world if it is stale or missing.
 */
export function resolveProfileSet({ manifest, sets, setId, segments }) {
  const definition = sets?.[setId];
  const byId = new Map((manifest?.profiles ?? []).map((profile) => [profile.id, profile]));
  const chosen = [];
  for (const id of definition?.profiles ?? []) {
    if (id === GENERATED_PROFILE_ID) chosen.push(generatedProfile());
    else if (byId.has(id)) chosen.push(byId.get(id));
    else {
      // A set may name one of the donor's silhouette families instead of a baked
      // profile, so a biome can be given a shape without an asset to extract.
      const shaped = shapedProfile(id);
      if (shaped) chosen.push(shaped);
    }
  }
  if (chosen.length === 0) chosen.push(generatedProfile());
  return chosen.map((profile) => resampleProfile(profile, segments));
}

/**
 * Lists what a Settings control can offer: every configured set, marked for
 * whether the manifest actually carries the profiles it names. A set whose assets
 * were never baked is still listed — hiding it would make a missing build artifact
 * look like a missing feature.
 */
export function describeProfileSets({ manifest, sets }) {
  const available = new Set((manifest?.profiles ?? []).map((profile) => profile.id));
  for (const id of GENERATED_SHAPE_IDS) available.add(id);
  available.add(GENERATED_PROFILE_ID);
  return Object.entries(sets ?? {}).map(([id, definition]) => {
    const names = definition?.profiles ?? [];
    const resolved = names.filter((name) => available.has(name));
    return {
      id,
      label: definition?.label ?? id,
      requested: names.length,
      resolved: resolved.length,
      complete: resolved.length === names.length,
    };
  });
}
