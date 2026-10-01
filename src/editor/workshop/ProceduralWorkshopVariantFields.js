import {
  defaultWorkshopVariant,
  getWorkshopVariant,
  isVariantArchetype,
  WORKSHOP_VARIANT_ARCHETYPES,
} from './ProceduralWorkshopArchetypeCatalog.js';

/** Form fields whose relevance depends on the archetype and design. */
const MANAGED_FIELDS = Object.freeze([
  'finish', 'style', 'topStyle', 'shape', 'width', 'depth', 'height',
  'towerSide', 'roofScale', 'roofOverhang', 'windows', 'ivy',
]);

/** Houses read every building field except the manor's tower wing, silhouette and ivy. */
const HOUSE_HIDDEN = new Set(['shape', 'towerSide', 'ivy']);

/** Every prop shows its stone style; the rest come from the variant's `uses`. */
const PROP_ALWAYS = Object.freeze(['style']);

const LABELS = Object.freeze({
  default: Object.freeze({ depth: 'Depth factor', height: 'Wall height (m)' }),
  house: Object.freeze({ depth: 'Depth (m)', height: 'Eave height (m)' }),
  prop: Object.freeze({ depth: 'Depth (m)', height: 'Height (m)' }),
});

function isVisible(field, archetype, variant) {
  if (archetype === 'house') return !HOUSE_HIDDEN.has(field);
  if (archetype === 'prop') return PROP_ALWAYS.includes(field) || (variant?.uses ?? []).includes(field);
  return true;
}

function variantOption({ id, label }) {
  const option = document.createElement('option');
  option.value = id;
  option.textContent = label;
  return option;
}

/** Options, gathered under an optgroup per catalogue `group` when variants declare one. */
function variantOptions(variants) {
  const groups = new Map();
  for (const variant of variants) {
    const key = variant.group ?? '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(variantOption(variant));
  }
  if (groups.size === 1 && groups.has('')) return groups.get('');
  return [...groups].map(([label, options]) => {
    const optgroup = document.createElement('optgroup');
    optgroup.label = label || 'Other';
    optgroup.append(...options);
    return optgroup;
  });
}

/**
 * The workshop form's design picker for variant-bearing archetypes.
 *
 * Choosing a house or prop design applies that design's defaults (name,
 * proportions, finishes) and hides the fields it does not read, so a barrel is
 * not offered a tower wing. The original archetypes keep every field.
 */
export class ProceduralWorkshopVariantFields {
  constructor(form) {
    this.form = form;
    this.field = form.querySelector('[data-workshop-field="variant"]');
    this.select = form.elements.variant;
  }

  get archetype() {
    return this.form.elements.archetype.value;
  }

  get variant() {
    return getWorkshopVariant(this.archetype, this.select.value);
  }

  onArchetypeChanged() {
    const entry = WORKSHOP_VARIANT_ARCHETYPES[this.archetype];
    this.select.replaceChildren(...variantOptions(entry?.variants ?? []));
    if (entry) {
      this.select.value = defaultWorkshopVariant(this.archetype);
      this.applyDefaults();
    }
    this.sync();
  }

  onVariantChanged() {
    this.applyDefaults();
    this.sync();
  }

  applyDefaults() {
    const defaults = this.variant?.defaults ?? {};
    for (const [name, value] of Object.entries(defaults)) {
      const element = this.form.elements[name];
      if (element) element.value = String(value);
    }
  }

  sync() {
    const archetype = this.archetype;
    const variant = this.variant;
    this.field.hidden = !isVariantArchetype(archetype);
    for (const name of MANAGED_FIELDS) {
      const wrapper = this.form.querySelector(`[data-workshop-field="${name}"]`);
      if (wrapper) wrapper.hidden = !isVisible(name, archetype, variant);
    }
    const labels = LABELS[isVariantArchetype(archetype) ? archetype : 'default'];
    for (const [name, text] of Object.entries(labels)) {
      const label = this.form.querySelector(`[data-workshop-label="${name}"]`);
      if (label) label.textContent = text;
    }
  }

  /** The recipe's `variant` field: present only for archetypes that have one. */
  readVariant() {
    return isVariantArchetype(this.archetype) ? { variant: this.select.value } : {};
  }
}
