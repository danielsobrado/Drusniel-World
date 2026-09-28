import { mix, output, vec4 } from 'three/tsl';

import { createJungleMistNodes, jungleMistUniforms, resolveJungleMistConfig } from './JungleMist.js';

const resolvedByBlock = new WeakMap();

/** The mist settings for an ambient block, resolved once per block. */
function mistSettings(ambientEffects) {
  if (!ambientEffects || ambientEffects.enabled === false) return null;
  if (!resolvedByBlock.has(ambientEffects)) {
    const settings = resolveJungleMistConfig(ambientEffects);
    resolvedByBlock.set(ambientEffects, settings.enabled ? settings : null);
  }
  return resolvedByBlock.get(ambientEffects);
}

/**
 * Blends the jungle ground mist over a material's lit, fogged output, the way the
 * donor blended it over the resolved frame: after lighting, so the mist carries
 * its own light instead of being shaded as if it were paint on the surface.
 *
 * Every opaque material a jungle pixel can show — ground, grass, trees — takes the
 * same blend, or the unfogged ones would stand out against the fogged ground.
 * Outside the jungle the mist's `If` on the region weight skips the closed form,
 * so the added cost is one uniform compare per fragment.
 *
 * Leaves the material alone (and returns false) when there is no ambient block,
 * the mist is off, or the material already owns its output node.
 *
 * @param {import('three/webgpu').NodeMaterial} material
 * @param {object | null | undefined} ambientEffects resolved `stylizedSurface.ambientEffects`
 */
export function applyJungleMist(material, ambientEffects) {
  if (material.outputNode) return false;
  const settings = mistSettings(ambientEffects);
  const mist = settings
    ? createJungleMistNodes({ settings, sunColor: jungleMistUniforms.sun, fill: jungleMistUniforms.fill })
    : null;
  if (!mist) return false;
  material.outputNode = vec4(mix(output.rgb, mist.color, mist.amount), output.a);
  return true;
}
