import {
  abs,
  clamp,
  dot,
  float,
  min,
  mix,
  normalize,
  oneMinus,
  sin,
  smoothstep,
  vec2,
  vec3,
} from 'three/tsl';
import { createSeaSwellNodes } from '../water/SeaSwell.js';
import { seaStateUniforms } from '../water/seaState.js';

/**
 * The open-sea swell on a water chunk: how far the sheet rises and falls, and
 * how that reads on an unlit material: `normal` tilts the reflection, which at
 * the grazing angles a sea is mostly seen at is what makes waves visible;
 * slopes turned toward the sun brighten and those turned away darken; crests
 * lift toward the highlight colour; and steep crests break into whitecaps,
 * more of them in a storm.
 *
 * Only sea water swells. The water field has no kind channel, so the sea is
 * water standing at the world's still-water level with no current: lakes sit
 * at their own level and rivers flow. The amplitude also falls to zero in the
 * shallows (`sea.shallowDepth`, and never more than `sea.depthRatio` of the
 * depth), so the waterline itself stays where the terrain puts it.
 *
 * Evaluated per vertex and interpolated: the shortest component is 7.5 m, over
 * a 2 m grid.
 */
export function createSeaSurfaceNodes({
  terrainUv,
  chunkWorldSize,
  surfaceWorldHeight,
  waterDepth,
  waterCoverage,
  currentStrength,
  time,
  phaseOrigin,
  sunDirection,
  config,
}) {
  const { storm, seaLevel } = seaStateUniforms;
  // Metres from the chunk centre on canonical axes, matching the chunk's world position.
  const localXZ = vec2(
    terrainUv.x.sub(0.5).mul(chunkWorldSize),
    float(0.5).sub(terrainUv.y).mul(chunkWorldSize),
  );
  const sharpness = float(config.choppiness * 0.075).mul(storm.mul(0.5).add(1));
  const swell = createSeaSwellNodes({ localXZ, phaseOrigin, time, sharpness });
  const seaMask = oneMinus(smoothstep(0.05, 0.3, abs(surfaceWorldHeight.sub(seaLevel))))
    .mul(oneMinus(clamp(currentStrength.mul(4), 0, 1)));
  const offshore = float(config.amplitude).mul(storm.mul(config.stormScale - 1).add(1));
  const amplitude = min(offshore, waterDepth.mul(config.depthRatio))
    .mul(smoothstep(0, config.shallowDepth, waterDepth))
    .mul(seaMask)
    .mul(waterCoverage)
    .toVarying('seaSwellAmplitude');
  const height = swell.height.toVarying('seaSwellHeight');
  const slope = swell.slope.mul(amplitude).toVarying('seaSwellSlope');
  // Share of full offshore height, so crests and whitecaps fade in the shallows.
  const strength = amplitude.div(offshore.max(1e-4));

  const normal = normalize(vec3(slope.x.negate(), 1, slope.y.negate()));
  const sun = normalize(sunDirection);
  const lit = dot(normal, sun).sub(sun.y);
  const crest = smoothstep(0.3, 0.95, height).mul(strength);
  // Whitecaps break into streaks along the crests. The breakup is built from the
  // swell's own phases, which are exact at any distance from the world origin:
  // a noise of canonical coordinates degrades into a regular lattice at
  // planet scale in float32.
  const [, , p2, p3, p4] = swell.phases;
  const breakup = smoothstep(0.25, 0.85, sin(p3.mul(3.3).add(p2.mul(1.7)))
    .mul(sin(p4.mul(2.1).sub(p2.mul(0.9))))
    .mul(0.5)
    .add(0.5))
    .toVarying('seaWhitecapBreakup');
  const threshold = mix(
    float(config.whitecapThreshold),
    float(config.stormWhitecapThreshold),
    storm,
  );

  return {
    displacement: swell.height.mul(amplitude),
    normal,
    shade(color, highlight) {
      const shaded = color.mul(float(1).add(lit.mul(config.slopeShading)));
      return mix(shaded, highlight, crest.mul(config.crestLift));
    },
    whitecap() {
      return smoothstep(threshold, 1, height).mul(strength).mul(breakup);
    },
  };
}
