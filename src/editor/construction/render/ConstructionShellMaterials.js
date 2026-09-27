import { STONE_PALETTES } from '../../workshop/ProceduralWorkshopMaterials.js';
import { constructionStoneRoundingProfile } from '../config/ConstructionStoneRoundingProfiles.generated.js';
import { constructionStyle, isConstructionStyleKey } from '../masonry/ConstructionStyleCatalog.js';

/**
 * Shell (far band and not-yet-built placeholder) material per style.
 *
 * Soft styles keep the shared ribbon material they always had. A rounded style
 * is light and warm, and a grey ribbon would visibly pop at every LOD switch, so
 * its shell takes the palette colour darkened by the profile's `shellShade` —
 * the crevice-darkened average of its near stones.
 *
 * The colour is set in linear space on purpose: stone vertex colours are
 * palette values used directly as linear multipliers, so matching them means
 * matching those numbers, not the palette's sRGB hex.
 */

/** Linear RGB a style's shell should use, or null for the shared ribbon. */
export function constructionShellLinearRgb(styleKey) {
  if (!isConstructionStyleKey(styleKey)) return null;
  const style = constructionStyle(styleKey);
  if (style.geometry !== 'rounded') return null;
  const palette = STONE_PALETTES[style.stonePalette];
  if (!palette) return null;
  const shade = constructionStoneRoundingProfile(styleKey).shellShade;
  return palette.base.map((channel) => (channel / 255) * shade);
}

export class ConstructionShellMaterials {
  /** @param defaultMaterial the view's shared ribbon material; not owned here */
  constructor(defaultMaterial) {
    this.defaultMaterial = defaultMaterial;
    this.byStyle = new Map();
  }

  forStyle(styleKey) {
    const rgb = constructionShellLinearRgb(styleKey);
    if (!rgb) return this.defaultMaterial;
    let material = this.byStyle.get(styleKey);
    if (!material) {
      material = this.defaultMaterial.clone();
      material.color.setRGB(rgb[0], rgb[1], rgb[2]);
      material.name = `construction-shell:${styleKey}`;
      this.byStyle.set(styleKey, material);
    }
    return material;
  }

  forRecord(record) {
    return this.forStyle(record?.style?.key);
  }

  dispose() {
    for (const material of this.byStyle.values()) material.dispose();
    this.byStyle.clear();
  }
}
