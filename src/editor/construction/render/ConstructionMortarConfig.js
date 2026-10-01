import { constructionJointProfile } from '../config/ConstructionJointProfiles.generated.js';

/**
 * Tuning and appearance for recessed mortar / core backing meshes.
 *
 * Geometry builders read these constants; keep visual tuning here rather than
 * scattering magic numbers through the prism writer.
 *
 * Field placements from the course packer carry authoritative `mortarCorners`
 * (the solved cell footprint). Those use `safetyOverlap` only — a few
 * millimetres to hide floating-point cracks. `legacyOverlapByCategory` remains
 * the fallback for dressings and older placement producers without footprints.
 *
 * `safetyOverlap` is taken from the joint-profile defaults so YAML remains the
 * editable source for the millimetre crack fill.
 */

const DEFAULT_JOINT_PROFILE = constructionJointProfile('default');

export const CONSTRUCTION_MORTAR_CONFIG = Object.freeze({
  /** Metres between the visible stone face and the mortar core face. */
  faceRecess: 0.055,
  /** Minimum backing prism thickness (m). */
  minimumDepth: 0.08,
  /** UV scale for future imported mortar textures. */
  uvDensity: 0.8,
  /**
   * Tiny absolute expansion when backing from authoritative `mortarCorners`.
   * Hides FP cracks between adjacent cell footprints — not a visual joint.
   */
  safetyOverlap: DEFAULT_JOINT_PROFILE.mortarSafetyOverlap,
  /** Fallback face-plane expansion for placements without mortarCorners (m). */
  legacyOverlapByCategory: Object.freeze({
    field: 0.024,
    ashlar: 0.014,
    quoin: 0.012,
    voussoir: 0.012,
    coping: 0.01,
    merlon: 0.01,
    default: 0.018,
  }),
  /** Cap on face expansion so tiny dressings cannot balloon. */
  maxCornerScale: 1.25,
});

/**
 * Style-keyed mortar appearance. Dry-stone reads as packed interior stone /
 * deep shadow, not pale cement.
 */
export const CONSTRUCTION_MORTAR_PROFILES = Object.freeze({
  'coursed-rubble': Object.freeze({
    color: '#5d5a53',
    roughness: 1,
    metalness: 0,
  }),
  'soft-limestone-rubble': Object.freeze({
    color: '#68675f',
    roughness: 1,
    metalness: 0,
  }),
  ashlar: Object.freeze({
    color: '#868174',
    roughness: 0.98,
    metalness: 0,
  }),
  'random-rubble': Object.freeze({
    color: '#666861',
    roughness: 1,
    metalness: 0,
  }),
  'dry-stone': Object.freeze({
    color: '#4f514c',
    roughness: 1,
    metalness: 0,
  }),
  // Mostly hidden by the rolled rims of rounded stones; warm and mid-dark so a
  // joint reads as a shadowed crevice rather than a hole through the wall.
  'rounded-fieldstone': Object.freeze({
    color: '#6b655b',
    roughness: 1,
    metalness: 0,
  }),
  // Hairline seams in the references read as thin shadowed lines of the stone's
  // own hue, not as grey cement.
  'glade-sandstone': Object.freeze({
    color: '#bd935f',
    roughness: 1,
    metalness: 0,
  }),
});

const DEFAULT_MORTAR_PROFILE = CONSTRUCTION_MORTAR_PROFILES['coursed-rubble'];

export function mortarProfile(styleKey) {
  return CONSTRUCTION_MORTAR_PROFILES[styleKey] ?? DEFAULT_MORTAR_PROFILE;
}

/**
 * Styles whose mortar core sits deeper than the shared `faceRecess`.
 *
 * A rounded stone's rim rolls back by its edge radius before it reaches the
 * joint, so a core at the shared 5.5 cm would sit level with the bottom of the
 * rims and read as a flat grey floor instead of a shadowed crevice.
 */
const FACE_RECESS_BY_STYLE = Object.freeze({
  'rounded-fieldstone': 0.07,
  // Behind the deepest recessed block (face relief reaches ~5 cm), so the
  // core never shows in front of a stone; the 3–7 mm seams hide its depth.
  'glade-sandstone': 0.075,
});

const styleConfigCache = new Map();

/** `CONSTRUCTION_MORTAR_CONFIG` with the style's own recess, if it has one. */
export function mortarConfigForStyle(styleKey) {
  const recess = FACE_RECESS_BY_STYLE[styleKey];
  if (recess == null) return CONSTRUCTION_MORTAR_CONFIG;
  let config = styleConfigCache.get(styleKey);
  if (!config) {
    config = Object.freeze({ ...CONSTRUCTION_MORTAR_CONFIG, faceRecess: recess });
    styleConfigCache.set(styleKey, config);
  }
  return config;
}

export function overlapForCategory(category, config = CONSTRUCTION_MORTAR_CONFIG) {
  const table = config.legacyOverlapByCategory;
  return table[category] ?? table.default;
}
