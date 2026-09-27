import * as THREE from 'three/webgpu';
import {
  attribute,
  cameraPosition,
  cameraViewMatrix,
  cameraWorldMatrix,
  color,
  cos,
  dot,
  fract,
  mix,
  modelWorldMatrix,
  normalize,
  positionGeometry,
  positionWorld,
  sin,
  smoothstep,
  texture,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';

/** Puffs this close to the camera collapse, and thin out over the next few metres. */
const NEAR_COLLAPSE = 1.5;
const NEAR_FADE = 10;
/** Height over the water across which a puff fades in, hiding where it cuts the surface. */
const SOFT_HEIGHT = 0.8;
const MIE_G = 0.6;
/** Light scattered forward toward a viewer looking into the sun. */
const PHASE_GAIN = 0.9;
const SKY_GAIN = 0.55;
const TWO_PI = Math.PI * 2;

/**
 * Camera-facing spray puffs animated on the GPU from each particle's constants
 * (see mistParticles): a puff rises and slows as it spreads, drifts
 * downstream, turns slowly and fades in and out over its life. Lit as a
 * sphere with a lit and a shaded side plus a forward-scattering lobe, so spray
 * glows against the sun. Positions are relative to the mesh, which the owner
 * places at its fall's foot, so one material serves every fall.
 *
 * @param {object} options
 * @param {THREE.Texture} options.puffs spray puff texture, one puff per channel
 * @param {object} options.time seconds uniform
 * @param {object} options.intensity overall opacity uniform
 * @param {{ sunDirection: object, sunColor: object, skyColor: object }} options.light uniforms
 */
export function createWaterfallMistMaterial({ puffs, time, intensity, light }) {
  const spawn = attribute('mistSpawn', 'vec4');
  const motion = attribute('mistMotion', 'vec4');
  const shape = attribute('mistShape', 'vec4');
  const age = fract(time.div(shape.z).add(motion.w));
  const seconds = age.mul(shape.z);
  // Height follows the integral of a rise speed that falls to zero at the end of life.
  const rise = motion.y.mul(seconds).mul(age.mul(-0.5).add(1));
  const center = vec3(
    spawn.x.add(motion.x.mul(seconds)),
    spawn.y.add(rise),
    spawn.z.add(motion.z.mul(seconds)),
  );
  const centerWorld = modelWorldMatrix.mul(vec4(center, 1)).xyz;
  const turn = motion.w.mul(TWO_PI).add(age.mul(motion.w.sub(0.5)).mul(1.2));
  const spin = vec2(cos(turn), sin(turn));
  const size = mix(shape.x, shape.y, age.sqrt())
    .mul(smoothstep(NEAR_COLLAPSE, NEAR_COLLAPSE * 1.6, cameraPosition.distance(centerWorld)));
  const corner = positionGeometry.xy;
  const screen = vec2(
    corner.x.mul(spin.x).sub(corner.y.mul(spin.y)),
    corner.x.mul(spin.y).add(corner.y.mul(spin.x)),
  );
  const right = cameraWorldMatrix.element(0).xyz;
  const up = cameraWorldMatrix.element(1).xyz;

  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    forceSinglePass: true,
  });
  material.name = 'Waterfall mist';
  material.fog = true;
  material.positionNode = center
    .add(right.mul(screen.x.mul(size)))
    .add(up.mul(screen.y.mul(size)));

  const puff = texture(puffs, uv());
  const variant = fract(motion.w.mul(7.31)).mul(4).floor();
  const density = variant.lessThan(1).select(puff.r, variant.lessThan(2).select(
    puff.g,
    variant.lessThan(3).select(puff.b, puff.a),
  ));
  const life = smoothstep(0, 0.1, age).mul(smoothstep(0.5, 1, age).oneMinus());
  const waterLevel = modelWorldMatrix.element(3).y.add(spawn.w);
  const soft = smoothstep(0, SOFT_HEIGHT, positionWorld.y.sub(waterLevel));
  const near = smoothstep(NEAR_COLLAPSE * 1.6, NEAR_FADE, cameraPosition.distance(positionWorld));
  material.opacityNode = density.mul(shape.w).mul(life).mul(soft).mul(near).mul(intensity);

  // The quad turns on screen, so its corner turns with it to give the sphere
  // normal in view space.
  const local = uv().sub(0.5).mul(2);
  const facing = vec2(
    local.x.mul(spin.x).sub(local.y.mul(spin.y)),
    local.x.mul(spin.y).add(local.y.mul(spin.x)),
  );
  const radius2 = dot(facing, facing);
  const normalView = normalize(vec3(facing.x, facing.y, radius2.oneMinus().max(0).sqrt()));
  const lightView = normalize(cameraViewMatrix.mul(vec4(light.sunDirection, 0)).xyz);
  const diffuse = dot(normalView, lightView).mul(0.5).add(0.5);
  // Cornette-Shanks phase; mu is 1 looking straight into the sun.
  const mu = lightView.z.negate();
  const g2 = MIE_G * MIE_G;
  const phase = mu.mul(mu).add(1).mul((3 / (8 * Math.PI)) * (1 - g2) / (2 + g2))
    .div(mu.mul(-2 * MIE_G).add(1 + g2).pow(1.5));
  material.colorNode = color('#dcebf2').mul(
    light.sunColor.mul(diffuse.mul(0.6).add(phase.mul(PHASE_GAIN)))
      .add(light.skyColor.mul(SKY_GAIN)),
  );
  return material;
}
