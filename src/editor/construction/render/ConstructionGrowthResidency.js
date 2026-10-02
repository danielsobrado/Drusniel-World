import { buildConstructionGrowth } from '../compile/ConstructionGrowthBuilder.js';
import { CONSTRUCTION_MATERIAL_SLOT } from './ConstructionMaterialSlots.js';

/** Update decoration alone; masonry, pending plans and collision stay resident. */
export function refreshConstructionGrowth(entry, terrainView) {
  const modules = new Map((entry.plan?.modules ?? []).map(module => [module.id, module]));
  for (const [id, resident] of entry.modules) {
    const module = modules.get(id);
    const stoneMeshes = resident.meshes.filter(mesh => mesh.userData.constructionMaterialSlot !== CONSTRUCTION_MATERIAL_SLOT.GROWTH);
    for (const mesh of resident.meshes) if (!stoneMeshes.includes(mesh)) {
      entry.group.remove(mesh); mesh.geometry.dispose();
    }
    resident.meshes = stoneMeshes;
    const oldTriangles = resident.stats?.growthTriangles ?? 0;
    if (resident.stats) {
      resident.stats.growthTriangles = 0; resident.stats.growthLeaves = 0;
      resident.stats.totalTriangles -= oldTriangles;
      resident.stats.triangles = resident.stats.totalTriangles;
    }
    if (!module || !stoneMeshes.length) continue;
    const mesh = buildConstructionGrowth({
      record: entry.record, materials: entry.materials, arcTable: entry.arcTable,
      moduleOrigin: entry.origin, pathInterval: module.pathInterval, placements: module.placements,
      lodBand: resident.builtBand ?? resident.band,
      groundHeightAt: (x, z) => terrainView.getCanonicalHeight(x, z) ?? 0,
    });
    if (!mesh) continue;
    mesh.name = `construction-masonry:${entry.record.id}:${module.id}:growth`;
    mesh.userData.constructionId = entry.record.id;
    mesh.visible = stoneMeshes[0].visible;
    entry.group.add(mesh); resident.meshes.push(mesh);
    resident.growthSource = { recordRevision: entry.record.revision, contentHash: module.contentHash,
      placements: module.placements, terrainRevision: terrainView.worldStore?.revision ?? 0 };
    if (resident.stats) {
      resident.stats.growthLeaves = mesh.userData.constructionGrowthLeaves;
      resident.stats.growthTriangles = mesh.geometry.index.count / 3;
      resident.stats.totalTriangles += resident.stats.growthTriangles;
      resident.stats.triangles = resident.stats.totalTriangles;
    }
  }
}
