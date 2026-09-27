import * as THREE from 'three/webgpu';
import { materialColor, texture, uv } from 'three/tsl';
import {
  SHELL_DETAIL_MEAN,
  SHELL_DETAIL_METERS,
  SHELL_DETAIL_URL,
} from './ConstructionShellDetailConfig.js';

/**
 * Stone pattern on the wall shell.
 *
 * The shell is what a wall is in the far LOD band — most walls in a zoomed-out
 * view — and before its masonry is built. A flat colour there read as a plastic
 * strip. The texture carries relative brightness only: the shell keeps its
 * per-style colour, and dividing by the texture's baked mean keeps that colour's
 * average, so far walls still match the near stones they stand in for.
 *
 * Shell UVs are wall-local metres (`ConstructionShell`), so the pattern is
 * stable under floating-origin rebases and the tile size lives here.
 */

/** Load the detail texture, or null where images cannot load (tests, workers). */
export function loadShellDetailTexture() {
  if (typeof Image === 'undefined') return null;
  const detail = new THREE.TextureLoader().load(SHELL_DETAIL_URL);
  detail.name = 'construction-shell-stone-detail';
  // Brightness factors, not colours: sample them as stored.
  detail.colorSpace = THREE.NoColorSpace;
  detail.wrapS = THREE.RepeatWrapping;
  detail.wrapT = THREE.RepeatWrapping;
  detail.anisotropy = 4;
  return detail;
}

/**
 * Multiply a shell material's colour by the stone pattern. Clones taken
 * afterwards share the node and keep their own colour.
 *
 * @param {THREE.MeshStandardNodeMaterial} material
 * @param {THREE.Texture | null} detail from `loadShellDetailTexture`
 */
export function applyShellDetail(material, detail) {
  if (!detail) return material;
  const pattern = texture(detail, uv().div(SHELL_DETAIL_METERS)).r;
  material.colorNode = materialColor.mul(pattern.div(SHELL_DETAIL_MEAN));
  material.needsUpdate = true;
  return material;
}
