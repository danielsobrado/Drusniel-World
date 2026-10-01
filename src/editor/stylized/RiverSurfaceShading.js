import * as THREE from 'three/webgpu';
import {
  abs,
  clamp,
  dot,
  float,
  fract,
  length,
  max,
  mix,
  normalize,
  oneMinus,
  pow,
  reflect,
  smoothstep,
  texture,
  vec2,
  vec3,
} from 'three/tsl';

/**
 * grass-test's lake and river surface (`WaterMaterial`, inland branch): its
 * procedural detail texture, flow-mapped detail normals, Fresnel, sun glint and
 * foam placement, ported onto the stylized water sheet.
 *
 * The donor draws each river as a ribbon parameterised by metres across and
 * along its course, and scrolls its detail down that course. Our sheet is the
 * terrain grid with a flow texture and no course coordinates, so the same two
 * detail phases are advected along the local current instead (a flow map), in
 * world metres. The donor's world runs at 2.8 units to the metre; its spatial
 * frequencies and speeds are converted, its shading constants are not.
 */

/** Detail tiles per metre. The donor's lake tile (0.065/unit) is 5.5 m, its river 1.6 × 8 m. */
const DETAIL_SCALE = 0.25;
/** The donor's micro layer (×3.7), rounded so it tiles the pattern period whole. */
const MICRO_SCALE = 4;
/** Turbulence streaks, the donor's (0.7, 2.4) of its current coordinates, taken isotropic. */
const STREAK_SCALE = 1.5;
/**
 * Detail coordinates are chunk-local metres plus the chunk centre wrapped to
 * this period in double precision (the water's `riverDetail` PatternOrigins
 * frame), so they stay exact at planet scale. It is a whole number of every tile
 * above (4 m, 1 m, 2⅔ m), so the wrap never shows.
 */
export const RIVER_DETAIL_PATTERN_PERIOD_METERS = 320;

let sharedDetailTexture = null;

function colorNode(value) {
  const color = new THREE.Color(value);
  return vec3(color.r, color.g, color.b);
}

/**
 * The donor's `createWaterDetailTexture`, verbatim: RG a tileable slope field
 * of four crossed cosines, B three octaves of periodic value noise for foam.
 */
export function createWaterDetailTexture() {
  const size = 256, data = new Uint8Array(size * size * 4);
  const noise = (x, y, cells) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const hash = (a, b) => {
      const n = Math.sin(((a + cells) % cells) * 127.1 + ((b + cells) % cells) * 311.7) * 43758.5453;
      return n - Math.floor(n);
    };
    return THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(hash(ix, iy), hash(ix + 1, iy), sx),
      THREE.MathUtils.lerp(hash(ix, iy + 1), hash(ix + 1, iy + 1), sx),
      sy,
    );
  };
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    const u = x / size * Math.PI * 2, v = y / size * Math.PI * 2;
    const dx = Math.cos(u * 3 + v * 4 + Math.sin(v * 2)) * 0.28
      + Math.cos(u * 5 - v * 2) * 0.19
      + Math.cos(u * 7 + v * 9 + Math.sin(u * 3)) * 0.09
      + Math.cos(u * 13 - v * 7) * 0.05;
    const dz = Math.cos(u * 3 + v * 4 + Math.sin(v * 2)) * 0.24
      - Math.cos(u * 5 - v * 2) * 0.12
      + Math.cos(u * 7 + v * 9 + Math.sin(u * 3)) * 0.13
      - Math.cos(u * 13 - v * 7) * 0.03;
    const k = (y * size + x) * 4;
    data[k] = Math.round((dx * 0.5 + 0.5) * 255);
    data[k + 1] = Math.round((dz * 0.5 + 0.5) * 255);
    data[k + 2] = Math.round((noise(x / size * 8, y / size * 8, 8) * 0.55
      + noise(x / size * 16, y / size * 16, 16) * 0.3
      + noise(x / size * 32, y / size * 32, 32) * 0.15) * 255);
    data[k + 3] = 255;
  }
  const result = new THREE.DataTexture(data, size, size);
  result.wrapS = result.wrapT = THREE.RepeatWrapping;
  result.minFilter = THREE.LinearMipmapLinearFilter;
  result.magFilter = THREE.LinearFilter;
  result.generateMipmaps = true;
  result.anisotropy = 8;
  result.needsUpdate = true;
  return result;
}

/** One detail texture for every water chunk. */
export function getWaterDetailTexture() {
  if (!sharedDetailTexture) {
    sharedDetailTexture = createWaterDetailTexture();
    sharedDetailTexture.name = 'Water detail';
  }
  return sharedDetailTexture;
}

/**
 * @param {object} options
 * @param {object} options.patternXZ vec2 node: metres on canonical axes, the
 *   `riverDetail` lattice point of the water's PatternOrigins
 * @param {object} options.flow vec2 node: the current, any length
 * @param {object} options.currentStrength float node, 0..1
 * @param {object} options.fall float node: the fall weight, 0..1
 * @param {object} options.waterDepth float node, metres
 * @param {object} options.shoreDistance float node, metres to the bank
 * @param {object} options.time seconds uniform
 * @param {object} options.sunDirection vec3 node toward the sun
 * @param {object} options.viewDirection vec3 node, surface to camera, unit
 * @param {object} options.config `stylizedSurface.water.riverSurface`
 */
export function createRiverSurfaceNodes({
  patternXZ,
  flow,
  currentStrength,
  fall,
  waterDepth,
  shoreDistance,
  time,
  sunDirection,
  viewDirection,
  config,
}) {
  const detail = getWaterDetailTexture();
  // The donor's `current`: 1 on a river, 0 on a lake. Our current is a field.
  const current = clamp(currentStrength.mul(4), 0, 1);
  const direction = flow.div(max(length(flow), 1e-4));
  const detailUv = patternXZ.mul(DETAIL_SCALE);
  // Drift per cross-fade cycle, in detail tiles. Still water keeps the donor's
  // lake drift (0.13, 0.07 of a tile per cycle), rivers move with the current.
  const cycle = float(config.cycleSeconds);
  const lakeDrift = vec2(0.13, 0.07).normalize().mul(config.stillDrift);
  const riverDrift = direction.mul(currentStrength.mul(config.currentDrift));
  const drift = mix(lakeDrift, riverDrift, current).mul(cycle.mul(DETAIL_SCALE));

  // Two phases half a cycle apart, each faded out as it jumps back.
  const phase = fract(time.div(cycle));
  const phaseB = fract(phase.add(0.5));
  const blend = abs(phase.mul(2).sub(1));
  const a = texture(detail, detailUv.sub(drift.mul(phase)));
  const b = texture(detail, detailUv.sub(drift.mul(phaseB)));
  const micro = texture(detail, detailUv.mul(MICRO_SCALE).add(vec2(time.mul(-0.018), time.mul(0.013))))
    .rg.mul(2).sub(1);
  const slope = mix(a.rg.mul(2).sub(1), b.rg.mul(2).sub(1), blend)
    .mul(mix(float(0.15), float(0.16), current))
    .add(micro.mul(0.025))
    .mul(config.normalStrength)
    .toVar('riverDetailSlope');

  // Across and down the current on a river, plain slopes on a lake.
  const across = vec3(direction.y.negate(), 0, direction.x);
  const downstream = vec3(direction.x, 0, direction.y);
  const riverTilt = across.mul(slope.x).add(downstream.mul(slope.y));
  const lakeTilt = vec3(slope.x.negate(), 0, slope.y.negate());
  const normal = normalize(vec3(0, 1, 0).add(mix(lakeTilt, riverTilt, current))).toVar('riverDetailNormal');

  const facing = max(dot(normal, viewDirection), 0);
  const fresnel = pow(oneMinus(facing), 5).mul(0.98).add(0.02).mul(0.85);
  // The donor reflects a cube probe; without one, its own fallback sky.
  const reflected = reflect(viewDirection.negate(), normal);
  const sky = mix(colorNode('#81a8b4'), colorNode('#38658a'), smoothstep(0, 0.7, reflected.y));

  const spec = max(dot(reflect(sunDirection.negate(), normal), viewDirection), 0);
  const glint = pow(spec, 170).mul(1.8).add(pow(spec, 20).mul(0.08))
    .mul(oneMinus(fall.mul(0.8)))
    .mul(max(sunDirection.y, 0).smoothstep(0, 0.08));

  // Foam: noise in the shallow band, streaks where the current runs fast,
  // and a fringe along the banks. Constants are the donor's; its depth band is
  // read in metres.
  const foamNoise = mix(a.b, b.b, blend);
  const turbulence = currentStrength.mul(config.fullCurrentSpeed).sub(0.7).mul(0.34)
    .clamp(0, 0.65).mul(current);
  const shore = smoothstep(0.02, 0.13, waterDepth).mul(oneMinus(smoothstep(0.22, 0.75, waterDepth)));
  const streakUv = detailUv.mul(STREAK_SCALE).add(vec2(0.3, 0.1));
  const streaks = mix(
    texture(detail, streakUv.sub(drift.mul(phase).mul(STREAK_SCALE))).b,
    texture(detail, streakUv.sub(drift.mul(phaseB).mul(STREAK_SCALE))).b,
    blend,
  );
  const riverShore = smoothstep(0.48, 0.78, foamNoise)
    .mul(shore.mul(0.6).add(turbulence.mul(pow(streaks, 3))));
  const bankFoam = oneMinus(smoothstep(0.1, config.bankFoamWidth, shoreDistance)).mul(current)
    .mul(smoothstep(0.3, 0.75, foamNoise)).mul(0.5);
  const foam = riverShore.add(bankFoam).mul(oneMinus(fall)).clamp(0, 0.94);

  return { fresnel, sky, glint, foam };
}
