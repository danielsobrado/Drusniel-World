/**
 * Glyphs for the spell dock on a 24-unit grid. Parts are classed rather than
 * coloured: `glyph-fill` and `glyph-line` take the tile's ink, `glyph-light`
 * and `glyph-shine` are highlights, all set in spell_menu.css.
 */
const SPELL_GLYPHS = Object.freeze({
  fire: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path class="glyph-fill" d="M12 2.6c1.1 3.7 5.7 5.7 5.7 11.1a5.7 5.7 0 0 1-11.4 0c0-2.8 1.3-4.7 2.9-6 .2 1.9 1 3.1 2.1 3.6-.5-3.2-.3-6 .7-8.7Z"/>
    <path class="glyph-light" d="M12.3 12.2c.8 1.3 2.4 2.1 2.4 4a2.7 2.7 0 0 1-5.4 0c0-1.4.8-2.4 1.8-3.1.1.7.4 1.2.9 1.4-.1-.9 0-1.6.3-2.3Z"/>
  </svg>`,
  water: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path class="glyph-fill" d="M12 2.8c4 4.7 6.3 8.1 6.3 11.4a6.3 6.3 0 0 1-12.6 0C5.7 10.9 8 7.5 12 2.8Z"/>
    <path class="glyph-shine" d="M9 14.2a3.1 3.1 0 0 0 2.7 3.1"/>
  </svg>`,
  air: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path class="glyph-line" d="M3.5 9.2h10.3a2.9 2.9 0 1 0-2.9-2.9"/>
    <path class="glyph-line" d="M3.5 13.2h14.2a2.9 2.9 0 1 1-2.9 2.9"/>
    <path class="glyph-line glyph-line--soft" d="M3.5 17.2h6.3"/>
  </svg>`,
  earth: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path class="glyph-fill" d="M3.8 17.8 7 8.6l5.2-3.4 5.7 3.2 2.4 9.2-5.4 2.6H8.4l-4.6-2.4Z"/>
    <path class="glyph-light" d="m7 8.6 5.2-3.4 5.7 3.2-5.6 4.4L7 8.6Z"/>
  </svg>`,
  lightning: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path class="glyph-fill" d="M13.8 2.4 5.4 13.6h5.4l-1.7 8.1 9.3-11.9h-5.6l1-7.4Z"/>
    <path class="glyph-light" d="M13.8 2.4 5.4 13.6h3.2l5.2-11.2Z"/>
  </svg>`,
  fireball: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path class="glyph-line glyph-line--soft" d="M9.4 12.9 4 18.3M11.2 15.2 7.4 19M7.6 10.8l-3.3 3.3"/>
    <circle class="glyph-fill" cx="14.6" cy="9.4" r="5.4"/>
    <circle class="glyph-light" cx="15.8" cy="8.2" r="2.2"/>
  </svg>`,
});

export function spellGlyph(spellId) {
  return SPELL_GLYPHS[spellId] ?? '';
}
