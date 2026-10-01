/**
 * Semantic hints the component classifier reads from generated geometry.
 *
 * `ProceduralWorkshopComponentParts` groups source geometry into editable
 * components. Tagged geometry is grouped by its tag; untagged wood and recess
 * geometry is *inferred* to be a door or window by its shape, which misfires on
 * timber framing and props. Generators should therefore tag everything they
 * emit, using these helpers so every archetype speaks the same format.
 */

export function tagOpeningGeometry(geometry, opening, door) {
  if (!opening.componentId) return geometry;
  geometry.userData.workshopSemantic = Object.freeze({
    id: opening.componentId,
    label: opening.componentLabel ?? (door ? 'Door' : 'Window'),
    kind: door ? 'door' : 'window',
    hostId: opening.hostId,
    attachmentPosition: Object.freeze([
      opening.surfaceX ?? opening.centerX ?? 0,
      opening.bottom,
    ]),
    attachmentSize: Object.freeze([
      opening.width,
      opening.springHeight + opening.radius,
    ]),
    assemblyId: opening.assemblyId ?? null,
    memberIds: opening.memberIds ? Object.freeze([...opening.memberIds]) : null,
  });
  return geometry;
}

/**
 * Tag geometry as part of a structure component.
 *
 * Optional fields describe a facade host that is not the front of its
 * building: `parentId` nests it under another structure (a storey's side wall
 * under the storey), `origin` pins its pivot to the facade's base centre, and
 * `yaw` turns its component frame so local +X runs along the wall and +Z out of
 * it — the frame the component editor assumes for every planar host.
 */
export function tagStructureGeometry(geometry, surface) {
  geometry.userData.workshopSemantic = Object.freeze({
    id: surface.id,
    label: surface.label,
    kind: 'structure',
    parentId: surface.parentId ?? null,
    attachmentSurface: Object.freeze({
      type: surface.type,
      width: surface.width,
      height: surface.height,
      radius: surface.radius ?? 0,
      ...(surface.origin ? { origin: Object.freeze([...surface.origin]) } : {}),
      ...(surface.yaw ? { yaw: surface.yaw } : {}),
    }),
  });
  return geometry;
}
