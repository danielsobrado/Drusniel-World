import { worldToCellPoint } from '../../world/WorldCoordinates.js';

/**
 * Adapts the editor's minimap and tile lookups to what `HudMinimap` needs, so
 * the HUD never reaches into EditorUi or the editor controller itself.
 *
 * @param {object} deps
 * @param {import('../../EditorUi.js').EditorUi} deps.ui owner of the minimap bitmap
 * @param {{ focusProvider?: () => { x: number, z: number } }} deps.controller
 * @param {{ tileSize: number, get: Function, getTileDefinition: Function }} deps.tileMap
 */
export function createHudMinimapSource({ ui, controller, tileMap }) {
  return Object.freeze({
    frame: ui.minimapFrame ?? null,
    getWindow: () => ({ center: ui.minimapCenter, cells: ui.minimapCells }),
    // Drawn at once rather than queued, so the new bitmap and the offset the
    // HUD derives from its centre land in the same frame.
    recenter: (cell) => {
      ui.minimapCenter = cell;
      ui.updateMinimap();
    },
    getFocusPoint: () => {
      const canonical = controller.focusProvider?.();
      return canonical ? worldToCellPoint(canonical.x, canonical.z, tileMap.tileSize) : null;
    },
    describeCell: (cellX, cellZ) => {
      const definition = tileMap.getTileDefinition(tileMap.get(cellX, cellZ));
      return definition ? { label: definition.label, color: definition.color } : null;
    },
  });
}
