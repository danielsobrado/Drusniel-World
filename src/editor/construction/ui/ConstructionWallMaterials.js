import { BUILTIN_WORKSHOP_MATERIAL_PRESETS } from '../../workshop/ProceduralWorkshopMaterialConfig.js';

/**
 * The material presets a wall can wear, shared by the radial palette and the
 * inspector.
 *
 * The palette's material ring can carry only a few petals, so it shows the
 * first `RING_MATERIAL_LIMIT`; the inspector behind "More…" lists every one,
 * custom presets included, so none is unreachable (phase 11 finding 11).
 */

/**
 * Families that make sense on a wall. The built-in masonry and plaster presets
 * are all `walls`; `stone` exists for custom presets authored against the
 * construction stone slot.
 */
export const WALL_PRESET_FAMILIES = new Set(['walls', 'stone']);

/** Petals the palette's material ring shows before "More…". */
export const RING_MATERIAL_LIMIT = 8;

/**
 * The built-ins plus any custom presets in the world's material library.
 *
 * `materialLibrary.presets` holds **only** custom presets — the built-ins are a
 * separate constant — so reading the library alone yields an empty list on a
 * fresh world.
 */
export function wallMaterialPresets(materialDocument) {
  const custom = materialDocument?.materialLibrary?.presets ?? {};
  return [...Object.values(BUILTIN_WORKSHOP_MATERIAL_PRESETS), ...Object.values(custom)]
    .filter((preset) => WALL_PRESET_FAMILIES.has(preset.family));
}

/** `<option>` markup for every wall preset, with the wall's current one selected. */
export function wallMaterialOptionsMarkup(presets, selectedId) {
  const known = presets.some(({ id }) => id === selectedId);
  const placeholder = known ? '' : '<option value="" selected>Style default</option>';
  return placeholder + presets
    .map(({ id, label }) => (
      `<option value="${escapeAttribute(id)}"${id === selectedId ? ' selected' : ''}>${escapeAttribute(label ?? id)}</option>`
    ))
    .join('');
}

function escapeAttribute(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
