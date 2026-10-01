import { constructionStyle } from './masonry/ConstructionStyleCatalog.js';

/** New strokes use the reviewed sandstone look; saved records keep their style. */
export const DEFAULT_DRAWING_STYLE_KEY = 'glade-sandstone';

/** Copy appearance intent, without the source wall's path, openings or damage. */
export function drawingLookFromRecord(record) {
  return Object.freeze({
    style: Object.freeze({
      ...record.style,
      ...(record.style.materials ? { materials: Object.freeze({ ...record.style.materials }) } : {}),
    }),
    topStyle: record.top.style,
  });
}

/** One draft factory for live previews and committed strokes. */
export function createConstructionDraft(path, id, { height, thickness, look = null }) {
  const numericId = Number.parseInt(String(id).match(/[0-9]+/)?.[0] ?? '1', 10);
  const style = constructionStyle(look?.style.key ?? DEFAULT_DRAWING_STYLE_KEY);
  return {
    version: 1, id, revision: 1, seed: numericId, kind: 'wall',
    label: `Curved wall ${numericId}`,
    style: look ? { ...look.style, materials: { ...look.style.materials } } : { key: style.key, version: 1 },
    dimensions: { height, thickness },
    top: { style: look?.topStyle ?? style.defaultTop ?? 'irregular' },
    path,
    features: path.features,
  };
}
