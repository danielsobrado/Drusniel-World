import * as THREE from 'three';

const FAR_TERRAIN_OBJECT_NAME = 'macro-far-terrain';

function setMaterialSide(material, side) {
  if (!material) return 0;
  if (Array.isArray(material)) {
    return material.reduce((count, entry) => count + setMaterialSide(entry, side), 0);
  }
  if (material.side === side) return 0;
  material.side = side;
  material.needsUpdate = true;
  return 1;
}

/**
 * Terrain occludes the world from either side in every view mode: orbit and
 * edit inspection can cross the heightfield, and the walker's camera loses
 * nothing by it.
 *
 * Terrain was once front-faced while walking. Changing `side` changes the
 * render object's cache key, so three rebuilt every terrain slot's node graph
 * on each mode switch — 49 slots at ~650 ms each, a ~17 s first frame
 * entering or leaving player mode. Front faces saved no measurable GPU time
 * (uncapped 1920×1080 walk: 157–179 fps front, 165–171 fps double), so the
 * side is now fixed at creation and this only repairs a material that differs.
 * `inspectionMode` is accepted for callers and no longer changes the result.
 */
export function applyTerrainInspectionMode(terrainView, inspectionMode) {
  void inspectionMode;
  if (!terrainView) return 0;
  let updated = 0;
  for (const slot of terrainView.slots ?? []) {
    updated += setMaterialSide(slot?.material, THREE.DoubleSide);
  }
  const farTerrain = terrainView.scene?.getObjectByName?.(FAR_TERRAIN_OBJECT_NAME);
  updated += setMaterialSide(farTerrain?.material, THREE.DoubleSide);
  return updated;
}
