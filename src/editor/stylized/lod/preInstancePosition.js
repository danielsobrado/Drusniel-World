import { positionLocal } from 'three/tsl';

/**
 * Transform an instanced mesh's vertices in its prototype's own space, before
 * the instance matrix places it.
 *
 * three r185 applies the instance matrix to `positionLocal` *before* a
 * material's `positionNode` runs (NodeMaterial.setupPosition), so inside
 * `positionNode` a vertex is already in mesh space — hundreds of metres from
 * the prototype's pivot. Anything meant to act on the prototype (a per-tree
 * scale about its trunk base) has to run earlier, which this does by
 * assigning `positionLocal` ahead of the material's own position setup.
 * `positionNode`, if any, still runs after instancing, in mesh space.
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
