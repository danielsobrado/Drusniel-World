import { positionLocal } from 'three/tsl';

/**
 * Transform an instanced mesh's vertices in its prototype's own space, before
 * the instance matrix places it.
 *
 * three applies the instance matrix to `positionLocal` *before* a
 * material's `positionNode` runs (NodeMaterial.setupPosition), so inside
 * `positionNode` a vertex is already in mesh space — hundreds of metres from
 * the prototype's pivot. Anything meant to act on the prototype (a per-tree
 * scale about its trunk base) has to run earlier, which this does by
 * assigning `positionLocal` ahead of the material's own position setup.
 * `positionNode`, if any, still runs after instancing, in mesh space.
 *
 * Written against r185. `NodeMaterial.setupPosition` still exists in the pinned
 * 0.186.1 (and this patch still installs), but the ordering above is UNVERIFIED
 * since the 2026-09-28 bump: no GPU was available to check it, and if r186
 * reordered the two, per-tree morphology would shift. Re-check alongside
 * `qa:vegetation:lod` / `qa:perf` — see docs/plans/grass-test-handover.md, the
 * browser-QA item.
 *
 * @param {THREE.NodeMaterial} material
 * @param {(position: object) => object} transform maps the prototype-space position node
 */
export function setPreInstancePosition(material, transform) {
  const setupPosition = material.setupPosition;
  material.setupPosition = function setupPreInstancePosition(builder) {
    positionLocal.assign(transform(positionLocal));
    return setupPosition.call(this, builder);
  };
  return material;
}
