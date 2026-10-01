import * as THREE from 'three/webgpu';
import {
  abs,
  cameraPosition,
  clamp,
  distance,
  dot,
  float,
  max,
  mix,
  oneMinus,
  positionLocal,
  positionWorld,
  sin,
  smoothstep,
  uv,
  vec2,
  vec3,
} from 'three/tsl';
import { assignTerrainMaterialData } from '../render/postprocessing/PostProcessingMaterialData.js';
import { createTerrainMaterialBakedSurface } from './materials/TerrainMaterialBakedNodes.js';
import {
  attachTerrainMaterialBakeGpuState,
  createTerrainMaterialBakeGpuState,
} from './materials/TerrainMaterialBakeGpu.js';
import {
  acquireTerrainMaterialFamilyAtlas,
  attachTerrainMaterialFamilyAtlas,
} from './materials/TerrainMaterialFamilyAtlas.js';
import {
  stylizedDirtMask,
  stylizedFbm,
  stylizedNaturalTrailMask,
  stylizedPatchMask,
  stylizedPathWearMask,
} from './stylized/StylizedNoiseNodes.js';
import { createCoastSwashNodes, DEFAULT_COAST_SWASH } from './stylized/CoastSwashShading.js';
import { createSnowSurfaceNodes } from './stylized/SnowSurfaceShading.js';
import { blownStreaks } from './stylized/ambient/BlownStreaks.js';
import { createFrostShading } from './stylized/ambient/FrostShading.js';
import { applyJungleMist } from './stylized/ambient/jungleMistOutput.js';
import { createValleyFogNodes } from './stylized/mist/ValleyFogShading.js';
import { createFootprintShading } from './stylized/deformation/FootprintShading.js';
import { acquirePathTextures, createTerrainPathPaint, resolvePathPaint } from './stylized/path/terrainPathPaint.js';
import { createSnowWakeShading } from './stylized/deformation/SnowWakeShading.js';
import { snowWakeRecorder } from './stylized/deformation/SnowWakeRecorder.js';
import { applyCloudShadow } from './stylized/CloudShadow.js';
import { createRainWetnessShading } from './stylized/RainWetnessShading.js';
import { resolveSurfaceWetnessConfig } from './weather/surfaceWetnessConfig.js';
import {
  createSlotBakeGpuState,
  slotPatternOrigins,
  slotTexture,
  slotVector2,
} from './materials/TerrainSlotBindings.js';

const HEIGHT_SHADE_SCALE = 0.018;
const MINIMUM_HEIGHT_SHADE = 0.72;
const MAXIMUM_HEIGHT_SHADE = 1.22;

function colorNode(value) {
  const color = new THREE.Color(value);
  return vec3(color.r, color.g, color.b);
}

/**
 * The terrain material. Its per-slot inputs are templates: every mesh drawn
 * with it supplies its own through TerrainSlotBindings, so one material (one
 * shader build) serves all slots. With `bakeGpuState`, the bake textures are
 * read from each mesh's own state too; without, the material carries a state
 * of its own, for a single mesh.
 */
export function createTerrainMaterial({
  tileTexture,
  heightTexture,
  surfaceMaskTexture,
  forestFloorTexture,
  chunkCenter: chunkCenterTemplate,
  // The slot's swash pattern origins (createCoastPatternOrigins). Without
  // them there is no swash: it cannot be drawn from canonical positions.
  coastPatterns: coastPatternsTemplate = null,
  chunkWorldSize,
  stylizedConfig,
  bakeGpuState = null,
  // The ambient surface terms (blown snow/sand streaks, rime), resolved once by
  // the caller from the ambient layer's block. Null (or disabled) adds no nodes.
  surfaceEffects = null,
  // The live sun (a Vector3 the sky turns in place for each time of day), for
  // snow shading. Without it, the configured sun.
  sunDirection = null,
}) {
  const terrainUv = uv();
  const tileColor = slotTexture('tileTexture', tileTexture, terrainUv).rgb;
  const terrainHeight = slotTexture('heightTexture', heightTexture, terrainUv).r;
  const surface = slotTexture('surfaceMaskTexture', surfaceMaskTexture, terrainUv);
  const forestFloorSample = slotTexture('forestFloorTexture', forestFloorTexture, terrainUv);
  const forestFloor = forestFloorSample.r;
  // The don't-hover patch under trunks and boulders: ambient occlusion rather than
  // shadow, so it does not move with the sun and it holds past the shadow map.
  const contactShade = forestFloorSample.g;
  const chunkCenter = slotVector2('chunkCenter', chunkCenterTemplate);
  const heightShade = clamp(
    terrainHeight.mul(HEIGHT_SHADE_SCALE).add(1),
    MINIMUM_HEIGHT_SHADE,
    MAXIMUM_HEIGHT_SHADE,
  );

  // Metres from the chunk centre, canonical axes.
  const localXZ = vec2(
    terrainUv.x.sub(0.5).mul(chunkWorldSize),
    float(0.5).sub(terrainUv.y).mul(chunkWorldSize),
  );
  const worldXZ = chunkCenter.add(localXZ);
  const cameraDistance = distance(cameraPosition, positionWorld);
  const dirtSettings = {
    scale: float(stylizedConfig.dirt.scale),
    coverage: float(stylizedConfig.dirt.coverage),
    softness: float(stylizedConfig.dirt.softness),
    warp: float(stylizedConfig.dirt.warp),
  };
  const patchSettings = {
    scale: float(stylizedConfig.patch.scale),
    bias: float(stylizedConfig.patch.bias),
  };
  const grassCoverage = surface.g;
  const proceduralDirt = stylizedDirtMask(worldXZ, dirtSettings).mul(grassCoverage);
  const pathConfig = stylizedConfig.path ?? {};
  const naturalTrailConfig = pathConfig.naturalTrail;
  const naturalTrail = naturalTrailConfig?.enabled
    ? stylizedNaturalTrailMask(worldXZ, {
      scale: float(naturalTrailConfig.scale),
      level: float(naturalTrailConfig.level),
      width: float(naturalTrailConfig.width),
      softness: float(naturalTrailConfig.softness),
      warp: float(naturalTrailConfig.warp),
    }).mul(grassCoverage)
    : float(0);
  const pathMask = max(surface.r, naturalTrail);
  const pathWear = stylizedPathWearMask(pathMask, worldXZ, {
    vergeWidth: float(pathConfig.vergeWidth ?? 0.45),
    vergeCut: float(pathConfig.vergeCut ?? 0.72),
    edgeScale: float(pathConfig.edgeScale ?? 0.42),
    edgeWarp: float(pathConfig.edgeWarp ?? 0.18),
  });
  const dirt = max(pathWear.wear, proceduralDirt);
  const patch = stylizedPatchMask(worldXZ, patchSettings);
  const grassTint = mix(
    colorNode(stylizedConfig.color.bottom),
    mix(
      colorNode(stylizedConfig.patch.lush),
      colorNode(stylizedConfig.patch.dry),
      patch,
    ),
    stylizedConfig.patch.strength,
  ).mul(stylizedConfig.color.brightness);
  let groundColor = mix(tileColor, grassTint, grassCoverage);
  groundColor = mix(
    groundColor,
    mix(grassTint, colorNode(stylizedConfig.dirt.color), pathConfig.vergeBlend ?? 0.55),
    pathWear.verge,
  );
  groundColor = mix(
    groundColor,
    colorNode(stylizedConfig.dirt.color),
    max(pathWear.tread, proceduralDirt),
  );
  const rutStrength = pathConfig.rutStrength ?? 0;
  if (rutStrength > 0) {
    const rutScale = pathConfig.rutScale ?? 1.6;
    const ruts = stylizedFbm(worldXZ.mul(rutScale)).sub(0.5)
      .add(stylizedFbm(worldXZ.mul(rutScale * 4.1).add(vec2(7.1, 3.7))).sub(0.5).mul(0.35));
    groundColor = groundColor.mul(
      float(1).add(ruts.mul(rutStrength).mul(pathWear.mask)),
    );
  }
  const forestFloorConfig = stylizedConfig.trees?.forestFloor ?? {};
  const forestFloorTint = forestFloor
    .mul(forestFloorConfig.groundStrength ?? 0.68)
    .mul(oneMinus(dirt));
  groundColor = mix(
    groundColor,
    colorNode(forestFloorConfig.groundCoreColor ?? '#273c25'),
    forestFloorTint,
  );

  const variation = stylizedFbm(worldXZ.mul(stylizedConfig.ground.variationScale)).sub(0.5);
  const grain = stylizedFbm(worldXZ.mul(stylizedConfig.ground.grainScale)).sub(0.5);
  const variationColor = colorNode(stylizedConfig.ground.variationColor);
  groundColor = groundColor.add(
    variationColor.sub(groundColor)
      .mul(variation)
      .mul(stylizedConfig.ground.variationStrength)
      .mul(dirt),
  );
  groundColor = groundColor.add(
    variationColor.sub(groundColor)
      .mul(grain)
      .mul(stylizedConfig.ground.grainStrength)
      .mul(dirt),
  );

  const farCover = stylizedConfig.groundCover;
  if (farCover?.enabled) {
    const retention = float(farCover.forestRetention ?? 0.5);
    const farMask = smoothstep(farCover.startDistance, farCover.endDistance, cameraDistance)
      .mul(grassCoverage)
      .mul(oneMinus(forestFloor.mul(oneMinus(retention))))
      .mul(oneMinus(dirt));
    const direction = vec2(farCover.direction[0], farCover.direction[1]);
    const strandA = smoothstep(
      farCover.strandThreshold,
      1,
      abs(sin(dot(worldXZ, direction).mul(farCover.frequency)
        .add(stylizedFbm(worldXZ.mul(farCover.noiseScale)).mul(farCover.noiseWarp)))),
    );
    const crossDirection = vec2(direction.y.negate(), direction.x);
    const strandB = smoothstep(
      Math.min(0.98, farCover.strandThreshold + 0.08),
      1,
      abs(sin(dot(worldXZ, crossDirection).mul(farCover.frequency * 1.37)
        .add(stylizedFbm(worldXZ.mul(farCover.noiseScale * 1.7).add(vec2(4.7, 9.2)))
          .mul(farCover.noiseWarp)))),
    );
    const strand = max(strandA, strandB.mul(0.7));
    const coverVariation = smoothstep(
      0.2,
      0.82,
      stylizedFbm(worldXZ.mul(farCover.noiseScale * 0.55).add(vec2(13.1, 5.3))),
    );
    const farGrass = mix(
      grassTint,
      colorNode(farCover.tipColor),
      strand.mul(farCover.tipStrength),
    );
    groundColor = mix(
      groundColor,
      farGrass,
      farMask.mul(farCover.strength).mul(mix(float(0.62), float(1), coverVariation)),
    );
  }

  // grass-test's duff under trunks and stones (GroundMaterial): the ground there
  // turns to darker leaf-litter duff, then darkens toward the contact point.
  // Last, so nothing painted after it can lift the patch back off the ground.
  // `contactShade` is 0 on bare ground and 1 under a trunk's centre.
  const pathPaintSettings = resolvePathPaint(pathConfig.paint);
  if (stylizedConfig.contactShade?.enabled !== false) {
    const dull = mix(vec3(dot(groundColor, vec3(0.3, 0.59, 0.11))), groundColor, 0.5)
      .mul(vec3(1, 0.94, 0.76));
    const duff = mix(
      dull.mul(0.45),
      colorNode(pathPaintSettings?.color ?? '#b7a476').mul(vec3(0.42, 0.35, 0.26)),
      0.5,
    );
    groundColor = mix(groundColor, duff, smoothstep(0.02, 0.35, contactShade));
    groundColor = groundColor.mul(oneMinus(smoothstep(0.1, 0.6, contactShade).mul(0.4)));
  }
  groundColor = max(groundColor, vec3(0));
  const proceduralColor = groundColor.mul(heightShade);
  const ownBakeGpu = bakeGpuState ? null : createTerrainMaterialBakeGpuState(stylizedConfig.materialBake);
  const materialBakeGpu = bakeGpuState ? createSlotBakeGpuState(bakeGpuState) : ownBakeGpu;
  const familyAtlas = acquireTerrainMaterialFamilyAtlas(stylizedConfig.materialBake);
  const material = new THREE.MeshStandardNodeMaterial({
    metalness: 0,
    roughness: stylizedConfig.materialBake.render.fallbackRoughness,
    // Double-sided in every view mode, and set here so it never changes: a
    // side change rebuilds this node graph per slot (see ViewModeSurfacePolicy).
    side: THREE.DoubleSide,
  });
  if (ownBakeGpu) attachTerrainMaterialBakeGpuState(material, ownBakeGpu);
  attachTerrainMaterialFamilyAtlas(material, familyAtlas);
  try {
    const bakedSurface = createTerrainMaterialBakedSurface({
      terrainUv,
      tileColor,
      heightShade,
      cameraDistance,
      proceduralColor,
      worldXZ,
      terrainHeight,
      familyAtlas,
      gpuState: materialBakeGpu,
      stylizedConfig,
    });
    // grass-test's path surface over the baked ground: textured dirt with a
    // broken contour and a worn verge (stylized/path/terrainPathPaint.js).
    const bakedRoughness = bakedSurface.roughness
      ?? float(stylizedConfig.materialBake.render.fallbackRoughness);
    const pathPaint = createTerrainPathPaint({
      terrainUv,
      chunkWorldSize,
      chunkCenter,
      pathMask,
      verge: pathWear.verge,
      settings: pathPaintSettings,
      textures: pathPaintSettings ? acquirePathTextures() : null,
    });
    const paintedSurface = pathPaint
      ? { ...bakedSurface, ...pathPaint.apply(bakedSurface.color, bakedRoughness) }
      : { ...bakedSurface, roughness: bakedRoughness };
    // Swash, foam and wet sand where the ground meets the sea.
    const swash = coastPatternsTemplate && createCoastSwashNodes({
      localXZ,
      patternOrigins: slotPatternOrigins('coastPatterns', coastPatternsTemplate),
      groundHeight: terrainHeight,
      config: { ...DEFAULT_COAST_SWASH, ...(stylizedConfig.water?.coast ?? {}) },
    });
    const shoreSurface = swash
      ? swash.apply(paintedSurface.color, paintedSurface.roughness)
      : paintedSurface;
    // Rain darkens and slicks exposed ground; snow and canopy shelter it.
    const surface = createRainWetnessShading({
      snow: bakedSurface.snow ?? float(0),
      canopy: bakedSurface.canopy ?? float(0),
      config: resolveSurfaceWetnessConfig(stylizedConfig.wetness),
    }).apply(
      shoreSurface.color,
      shoreSurface.roughness ?? float(stylizedConfig.materialBake.render.fallbackRoughness),
    );
    const snowSurface = bakedSurface.snow
      ? createSnowSurfaceNodes({
        terrainUv,
        chunkWorldSize,
        chunkCenter,
        snow: bakedSurface.snow,
        stylizedConfig,
        sunDirection,
      })
      : null;
    const footprints = createFootprintShading({
      terrainUv,
      chunkWorldSize,
      chunkCenter,
      groundHeight: terrainHeight,
      snow: bakedSurface.snow ?? float(0),
    });
    const snowColor = snowSurface ? snowSurface.apply(surface.color) : surface.color;
    // The trail a body cuts through deep snow, over the prints it leaves there.
    // Disabled or snowless, it compiles to nothing.
    const wake = createSnowWakeShading({
      terrainUv,
      chunkWorldSize,
      chunkCenter,
      snow: bakedSurface.snow,
      state: snowWakeRecorder.state,
      config: stylizedConfig.snowWake,
    });
    const printed = footprints.apply(snowColor);
    material.colorNode = wake ? wake.apply(printed) : printed;
    material.roughnessNode = surface.roughness;
    if (snowSurface) material.emissiveNode = snowSurface.emissive;
    if (bakedSurface.normal) material.normalNode = bakedSurface.normal;
    // Wind-blown snow and sand streaming across the ground, behind the ambient
    // layer's own weights. The snow streak keys on the baked snow the terrain
    // already draws (so a material with no snow field adds none) and the sand
    // streak on open, bare ground — the region gate in the shared uniform keeps
    // that to beaches and deserts.
    const streaks = surfaceEffects?.blownStreaks ?? null;
    const airStreak = streaks?.enabled
      ? max(
        streaks.snow && bakedSurface.snow
          ? blownStreaks({ worldXZ, kind: 'snow', weight: bakedSurface.snow, settings: streaks })
          : float(0),
        streaks.sand
          ? blownStreaks({ worldXZ, kind: 'sand', weight: oneMinus(grassCoverage), settings: streaks })
          : float(0),
      )
      : null;
    if (airStreak) {
      // Airborne snow and sand scatter their own light, so they add rather than
      // lighten the ground they cross.
      material.emissiveNode = material.emissiveNode
        ? max(material.emissiveNode, airStreak)
        : airStreak;
    }
    // Rime on the up-facing faces, keyed on the same baked snow: the deposition the
    // terrain would otherwise wash out. Needs a surface normal, so it too compiles
    // to nothing where the terrain has no normal to read.
    const frost = surfaceEffects?.frost?.enabled && bakedSurface.normal && bakedSurface.snow
      ? createFrostShading({
        normal: bakedSurface.normal,
        worldXZ,
        cold: bakedSurface.snow,
        settings: surfaceEffects.frost,
      })
      : null;
    if (frost) {
      material.colorNode = frost.applyColor(material.colorNode);
      material.roughnessNode = frost.applyRoughness(material.roughnessNode);
    }
    // Valley mist pooling in the gorges below the view, marched against the
    // camera-local height patch. It blends last, over everything, because it sits
    // in the air in front of the ground rather than on it. Null (no config, no
    // patch, quality zero) adds nothing; a runtime weight of zero skips its loop.
    const fog = surfaceEffects?.valleyFog
      ? createValleyFogNodes({
        heightSampler: surfaceEffects.valleyFog.patch,
        config: surfaceEffects.valleyFog.settings,
        time: surfaceEffects.valleyFog.uniforms.time,
        weight: surfaceEffects.valleyFog.uniforms.weight,
        quality: surfaceEffects.valleyFog.quality,
        sunDirection: surfaceEffects.valleyFog.uniforms.sunDirection,
        sunColor: surfaceEffects.valleyFog.uniforms.sunColor,
        fogColor: surfaceEffects.valleyFog.uniforms.fogColor,
      })
      : null;
    if (fog) {
      material.colorNode = mix(material.colorNode, fog.color, fog.amount);
    }
    // Jungle ground mist, blended over the lit output like the grass and trees
    // that stand in it; a zero region weight skips it with one compare.
    applyJungleMist(material, surfaceEffects?.ambientEffects);
    // Geometry displacement and the baked surface normal are derived from the same heightfield.
    material.positionNode = positionLocal.add(vec3(0, 0, terrainHeight));
    applyCloudShadow(material, stylizedConfig.sky);
    return assignTerrainMaterialData(material);
  } catch (error) {
    material.dispose();
    throw error;
  }
}
