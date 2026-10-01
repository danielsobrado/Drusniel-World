import {
  attribute,
  float,
  step,
  vec3,
} from 'three/tsl';
import { authoredTexture } from '../AuthoredTextureNode.js';
import { orientedScreenDitherThreshold } from './screenDither.js';
import { characterOcclusionKeep } from '../../character/CharacterOcclusion.js';
import { setPreInstancePosition } from './preInstancePosition.js';

export function createSourceOpacityNode(material) {
  if (material.opacityNode) return material.opacityNode;
  // Keep the implicit UV node so TextureNode applies loader-provided
  // KHR_texture_transform matrices from optimized glTF assets.
  let opacity = material.map ? authoredTexture(material.map).a : null;
  if (material.alphaMap) {
    const alphaMapOpacity = authoredTexture(material.alphaMap).g;
    opacity = opacity ? opacity.mul(alphaMapOpacity) : alphaMapOpacity;
  }
  const scalarOpacity = Number.isFinite(material.opacity) ? material.opacity : 1;
  if (scalarOpacity < 1) {
    opacity = opacity ? opacity.mul(scalarOpacity) : float(scalarOpacity);
  }
  return opacity;
}

/**
 * Per-tree crown and trunk scale about the prototype's pivot. It must act in the
 * prototype's own space, so it runs before the instance matrix (see
 * preInstancePosition); applied after it, the scale pulled every crown toward the
 * mesh origin and parted it from its trunk by tens of metres. The source
 * material's wind stays in `positionNode`, after instancing, in world axes.
 */
function applyMorphology(material, kind, pivot) {
  if (kind !== 'leaf' && kind !== 'trunk') return;
  const morphology = attribute('instanceMorphology', 'vec3');
  const horizontalScale = kind === 'leaf' ? morphology.x : morphology.z;
  const verticalScale = kind === 'leaf' ? morphology.y : float(1);
  const pivotX = float(pivot.x);
  const pivotY = float(pivot.y);
  const pivotZ = float(pivot.z);
  setPreInstancePosition(material, (position) => vec3(
    position.x.sub(pivotX).mul(horizontalScale).add(pivotX),
    position.y.sub(pivotY).mul(verticalScale).add(pivotY),
    position.z.sub(pivotZ).mul(horizontalScale).add(pivotZ),
  ));
  material.userData.treeMorphologyPivot = [pivot.x, pivot.y, pivot.z];
  material.userData.treeMorphologyPivotY = pivot.y;
}

/**
 * `tinted` adds a per-instance vec3 on top of the scalar brightness variation.
 * `kind` selects the per-instance tree morphology transform. Other scatter layers
 * keep the identity morphology written by the shared instance runtime.
 */
export function createDitheredMaterial(sourceMaterial, {
  tinted = false,
  kind = null,
  morphologyPivot = null,
  morphologyPivotY = 0,
} = {}) {
  const material = sourceMaterial.clone();
  // A classic material's clone() drops node properties; keep a position node the
  // source layer gave it (ground-detail wind).
  if (sourceMaterial.positionNode && !material.positionNode) material.positionNode = sourceMaterial.positionNode;
  // Packed per-instance scalars; see createGeometry in StylizedLodRuntime for why these
  // share one attribute rather than taking a vertex buffer each.
  const dither = attribute('instanceDither', 'vec3');
  const signedFade = dither.x;
  const seed = dither.y;
  const colorVariation = dither.z;
  const sourceOpacity = createSourceOpacityNode(material);
  const fadeMask = step(
    orientedScreenDitherThreshold(seed, signedFade),
    signedFade.abs(),
  );
  // Dither the LOD transition, not the texture's alpha. Multiplying alpha into
  // the threshold made partially transparent leaf texels sample a new random
  // screen pattern even at fade=1, so a stationary crown sparkled as the camera
  // moved. At full coverage this now resolves to the original stable cutout.
  material.opacityNode = sourceOpacity ? sourceOpacity.mul(fadeMask) : fadeMask;
  if (material.colorNode) {
    const variation = tinted
      ? attribute('instanceLeafTint', 'vec3').mul(colorVariation)
      : colorVariation;
    material.colorNode = material.colorNode.mul(variation);
  }
  applyMorphology(
    material,
    kind,
    morphologyPivot ?? { x: 0, y: morphologyPivotY, z: 0 },
  );
  // Canopy between the third-person camera and the player dithers open around
  // the player's silhouette. Leaves only: they cast no shadow, so the shadow
  // pass's fallback to maskNode never sees the view-space cut.
  if (kind === 'leaf') {
    const keep = characterOcclusionKeep();
    material.maskNode = material.maskNode ? material.maskNode.and(keep) : keep;
  }
  material.alphaTest = sourceOpacity
    ? Math.max(0.001, sourceMaterial.alphaTest ?? 0.32)
    : 0.5;
  material.transparent = false;
  material.depthWrite = true;
  return material;
}
