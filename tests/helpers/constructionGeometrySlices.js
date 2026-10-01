/** Slice actual indexed or unindexed triangles; valid for prisms and fitted polygons. */
export function geometrySpansAt(geometry, y) {
  const position = geometry.getAttribute('position');
  const count = geometry.index?.count ?? position.count;
  const spans = [];
  for (let triangle = 0; triangle < count; triangle += 3) {
    const vertices = [0, 1, 2].map(i => geometry.index?.getX(triangle + i) ?? triangle + i);
    const xs = [];
    for (let edge = 0; edge < 3; edge += 1) {
      const a = vertices[edge]; const b = vertices[(edge + 1) % 3];
      const ay = position.getY(a); const by = position.getY(b);
      if (Math.abs(ay - y) < 1e-7) xs.push(position.getX(a));
      if ((ay < y && by > y) || (ay > y && by < y)) {
        xs.push(position.getX(a) + (position.getX(b) - position.getX(a)) * (y - ay) / (by - ay));
      }
    }
    if (xs.length >= 2) spans.push([Math.min(...xs), Math.max(...xs)]);
  }
  return spans.sort((a, b) => a[0] - b[0]);
}
