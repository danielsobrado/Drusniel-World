/** Perimeter bevel dimensions, shared by every ring of a stone face. */
export function createPillowRim(outline, face, halfDepth) {
  const widths = new Float64Array(outline.pointCount);
  const depths = new Float64Array(outline.pointCount);
  const uniform = Math.min(face.edgeRadius, outline.cornerRadius);
  for (let point = 0; point < outline.pointCount; point += 1) {
    const index = outline.wearIndex(point);
    // Leave a short arc at the innermost corners instead of collapsing two
    // adjacent vertices when a large bevel meets a small worn corner.
    widths[point] = face.rimWidths
      ? Math.min(face.edgeRadius * face.rimWidths[index], outline.insetLimit(point) * 0.9)
      : uniform;
    depths[point] = face.rimDepths
      ? Math.min(face.edgeRadius * face.rimDepths[index], halfDepth * 0.6)
      : uniform;
  }
  return { widths, depths };
}
