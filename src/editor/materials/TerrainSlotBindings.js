import { texture, uniform } from 'three/tsl';

import { getTerrainMaterialBakeGpuState } from './TerrainMaterialBakeGpu.js';

/**
 * One terrain material shared by every terrain slot, each slot drawing its own
 * data: the texture and uniform nodes here take their value from the mesh
 * being drawn (`onObjectUpdate`), just before its bindings update.
 *
 * Why: three keys a node build by node identity, so 49 slots with 49 copies of
 * the terrain graph meant 49 builds of ~0.6 s each — at boot, and again for
 * every render path a slot first appears in (entering player mode switches to
 * the god-rays pass: a ~17 s first frame). Shared nodes share one build.
 *
 * A slot mesh carries `userData[TERRAIN_SLOT_KEY]` — its tile, height, surface
 * mask and forest floor textures, its `chunkCenter` uniform and its
 * `coastPatterns` origins — and its bake
 * GPU state (attachTerrainMaterialBakeGpuState on the mesh). The templates are
 * one slot's own, which fix texture formats at build time and stand in for a
 * mesh without slot data.
 */
export const TERRAIN_SLOT_KEY = 'terrainSlot';

function slotData(object) {
  return object?.userData?.[TERRAIN_SLOT_KEY] ?? null;
}

/**
 * A texture node updated per drawn object. TextureNode.setup resets
 * `updateType` to NONE unless the node carries a uv-matrix uniform, which
 * would silently drop `onObjectUpdate` — every slot would keep whichever
 * texture its binding first saw. `setUpdateMatrix(true)` keeps the node an
 * OBJECT update; the callback replaces the matrix update, so the uv matrix stays
 * the template's identity (one extra mat3 multiply per sample).
 */
function perObjectTexture(template, uvNode, read) {
  return texture(template, uvNode)
    .setUpdateMatrix(true)
    .onObjectUpdate(({ object }) => read(object) ?? template);
}

/** A texture node that samples the drawn slot's own texture `name`. */
export function slotTexture(name, template, uvNode) {
  return perObjectTexture(template, uvNode, (object) => slotData(object)?.[name]);
}

/** A vec2 uniform following the drawn slot's own uniform `name`. */
export function slotVector2(name, template) {
  return uniform(template.value.clone())
    .onObjectUpdate(({ object }) => slotData(object)?.[name]?.value ?? template.value);
}

/** The drawn slot's own PatternOrigins `name`, as the shared material reads it. */
export function slotPatternOrigins(name, template) {
  return template.perObject((object) => slotData(object)?.[name]);
}

/**
 * The bake GPU state as the shared material sees it: textures sampled from the
 * drawn slot's state, and its ready/stale/blend read per object. Same shape as
 * a real state for createTerrainMaterialBakedSurface, plus `sampleTexture`.
 */
export function createSlotBakeGpuState(template) {
  if (!template) return null;
  const perObject = (field) => uniform(0)
    .onObjectUpdate(({ object }) => getTerrainMaterialBakeGpuState(object)?.[field]?.value ?? 0);
  return {
    resolution: template.resolution,
    textures: template.textures,
    ready: perObject('ready'),
    stale: perObject('stale'),
    blend: perObject('blend'),
    sampleTexture(name, uvNode) {
      return perObjectTexture(
        template.textures[name],
        uvNode,
        (object) => getTerrainMaterialBakeGpuState(object)?.textures?.[name],
      );
    },
  };
}
