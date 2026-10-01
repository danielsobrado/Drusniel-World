const EPSILON = 1e-6;

/**
 * Open edges of a small, resolved ornament layout in its (arc, height) plane.
 * Contacts come from the layout's units, before joints or jitter are applied.
 * A partially supported edge stays shaded; only fully open edges lose contact
 * shading. Use on bounded ornament groups, not a wall-wide all-pairs scan.
 */
export function resolvePlanarUnitExposure(units, { groundHeight = -Infinity } = {}) {
  const boxes = units.map(unit => ({
    left: unit.s - unit.width / 2, right: unit.s + unit.width / 2,
    bottom: unit.y - unit.height / 2, top: unit.y + unit.height / 2,
  }));
  const touches = (a, b) => Math.abs(a - b) < EPSILON;
  const overlaps = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0) > EPSILON;
  return units.map((unit, index) => {
    const box = boxes[index];
    const exposure = { top: true, bottom: box.bottom > groundHeight + EPSILON, start: true, end: true };
    for (let other = 0; other < boxes.length; other += 1) {
      if (other === index) continue;
      const neighbor = boxes[other];
      if (overlaps(box.left, box.right, neighbor.left, neighbor.right)) {
        if (touches(box.top, neighbor.bottom)) exposure.top = false;
        if (touches(box.bottom, neighbor.top)) exposure.bottom = false;
      }
      if (overlaps(box.bottom, box.top, neighbor.bottom, neighbor.top)) {
        if (touches(box.left, neighbor.right)) exposure.start = false;
        if (touches(box.right, neighbor.left)) exposure.end = false;
      }
    }
    return { ...unit, exposure: Object.freeze(exposure) };
  });
}
