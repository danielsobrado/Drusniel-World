/**
 * The humanoid rig contract for authored characters.
 *
 * Every roster character is a Meshy export on the same named skeleton. Three
 * generations exist — a 24-joint armature exported in centimetres under a 0.01
 * `Armature` node, a 28-joint one in metres that adds `*_End` leaf bones, and a
 * Mixamo-named one whose bones carry a `mixamorig:` prefix (which three.js's
 * loader turns into `mixamorig`) — but all carry the bones named here once the
 * prefix is set aside, which is all the runtime touches: the legs for foot
 * placement and swimming, the arms for the cast pose and the stroke. The asset
 * validator reads the same list, so a GLB that would break any of them is
 * rejected offline rather than at the moment a player picks it.
 */

const MIXAMO_PREFIX = /^mixamorig:?/;

/** A bone's role name: its node name without any Mixamo prefix. */
export function humanoidBoneRole(name) {
  return String(name ?? '').replace(MIXAMO_PREFIX, '');
}

/** Required bones missing from a list of node names, prefix-insensitively. */
export function missingHumanoidBones(nodeNames) {
  const roles = new Set([...nodeNames].map(humanoidBoneRole));
  return REQUIRED_HUMANOID_BONES.filter((name) => !roles.has(name));
}

const SIDES = Object.freeze(['Left', 'Right']);

const LIMB_BONES = Object.freeze({
  upLeg: 'UpLeg',
  leg: 'Leg',
  foot: 'Foot',
  arm: 'Arm',
  foreArm: 'ForeArm',
  hand: 'Hand',
});

export const REQUIRED_HUMANOID_BONES = Object.freeze([
  'Hips',
  'Head',
  ...SIDES.flatMap((side) => Object.values(LIMB_BONES).map((bone) => `${side}${bone}`)),
]);

/**
 * Upper-body bones whose standing pose is taken from the walk cycle's mean
 * (see `standingPose.js`). The legs are deliberately absent.
 */
export const UPPER_BODY_BONE = /^Spine|^neck$|^Neck$|^Head$|Shoulder$|Arm$|Hand$/;

/**
 * Index a loaded model's skeleton by role.
 *
 * @param {import('three').Object3D} model
 * @returns {{
 *   byName: Map<string, import('three').Bone>, keyed by role name (prefix removed)
 *   hips: import('three').Bone,
 *   head: import('three').Bone,
 *   left: Record<keyof typeof LIMB_BONES, import('three').Bone>,
 *   right: Record<keyof typeof LIMB_BONES, import('three').Bone>,
 * }}
 */
export function collectHumanoidBones(model) {
  const byName = new Map();
  model.traverse((object) => {
    const role = humanoidBoneRole(object.name);
    if (object.isBone && !byName.has(role)) byName.set(role, object);
  });
  const missing = REQUIRED_HUMANOID_BONES.filter((name) => !byName.has(name));
  if (missing.length > 0) {
    throw new Error(`Character rig is missing humanoid bones: ${missing.join(', ')}.`);
  }
  const limb = (side) => Object.fromEntries(
    Object.entries(LIMB_BONES).map(([role, suffix]) => [role, byName.get(`${side}${suffix}`)]),
  );
  return {
    byName,
    hips: byName.get('Hips'),
    head: byName.get('Head'),
    left: limb('Left'),
    right: limb('Right'),
  };
}
