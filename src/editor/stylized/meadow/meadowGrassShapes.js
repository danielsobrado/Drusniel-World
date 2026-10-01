/**
 * Grass silhouettes, ported from grass-test's `grassShapes.js`.
 *
 * The donor bakes one silhouette per field into its blade template. Here every
 * blade carries its shape as an id and the vertex shader applies the profile, so
 * one template per LOD band draws every biome's grass in a single batch — reeds
 * in the wetland, broadleaves in the tropics — without a draw per shape.
 *
 * Grass is fill-rate bound long before it is triangle bound: every shape draws
 * the same vertices, so the only cost that varies is how many pixels a blade
 * covers — the integral of width(r) × widthScale. The donor measured broadleaf
 * at widthScale 1.6 costing 44% frame time at the same triangle count, and keeps
 * every shape within ~1.35× of slender's 0.5; these are its values.
 */
export const MEADOW_GRASS_SHAPES = Object.freeze({
  slender: Object.freeze({ id: 0, label: 'Slender', widthScale: 1, width: (r) => 1 - r }),
  reed: Object.freeze({ id: 1, label: 'Reed', widthScale: 0.55, width: (r) => 1 - r ** 5 }),
  broadleaf: Object.freeze({ id: 2, label: 'Broadleaf', widthScale: 0.85, width: (r) => Math.sqrt(Math.max(0, 1 - r * r)) }),
});

export const DEFAULT_MEADOW_SHAPE = 'slender';
/** Shapes a look code spans before its palette index: code = shape + count × palette. */
export const MEADOW_SHAPE_COUNT = Object.keys(MEADOW_GRASS_SHAPES).length;

export function meadowShapeId(name) {
  return (MEADOW_GRASS_SHAPES[name] ?? MEADOW_GRASS_SHAPES[DEFAULT_MEADOW_SHAPE]).id;
}

/**
 * The shape each biome's grass wears, as a lookup by tile id. Unlisted biomes
 * take the default. Resolved from `grass.meadow.shapes.byTileId`.
 *
 * @param {Record<string, string> | undefined} byTileId
 * @returns {Uint8Array} 256 entries, shape id per tile id
 */
export function resolveShapeTable(byTileId, fallback = DEFAULT_MEADOW_SHAPE) {
  const table = new Uint8Array(256).fill(meadowShapeId(fallback));
  for (const [tile, name] of Object.entries(byTileId ?? {})) {
    const id = Number(tile);
    if (!Number.isInteger(id) || id < 0 || id > 255) {
      throw new Error(`Invalid editor configuration: grass.meadow.shapes.byTileId key ${tile} is not a tile id.`);
    }
    if (!MEADOW_GRASS_SHAPES[name]) {
      throw new Error(`Invalid editor configuration: grass.meadow.shapes.byTileId.${tile} names an unknown shape "${name}".`);
    }
    table[id] = MEADOW_GRASS_SHAPES[name].id;
  }
  return table;
}
