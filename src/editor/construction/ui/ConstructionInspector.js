import { CONSTRUCTION_STYLES } from '../masonry/ConstructionStyleCatalog.js';
import { CONSTRUCTION_GROWTH_PROFILES } from '../config/ConstructionGrowthProfiles.generated.js';
import { wallMaterialOptionsMarkup, wallMaterialPresets } from './ConstructionWallMaterials.js';

/**
 * Compact wall inspector opened from the construction palette's "More…".
 *
 * Height, thickness and masonry style are the edits the radial petals do not
 * cover, and the material list is complete here where the ring shows only a
 * few presets. Albedo import stays deferred — the material store and its caps are
 * ready; the file picker belongs with a fuller inspector later.
 */

/** Pure markup for the masonry-style `<select>` options. */
export function constructionStyleOptionsMarkup(selectedKey) {
  return Object.values(CONSTRUCTION_STYLES)
    .map(({ key, label }) => (
      `<option value="${key}"${selectedKey === key ? ' selected' : ''}>${label}</option>`
    ))
    .join('');
}

/** Human-readable status line for a masonry style change. */
export function masonryStyleStatusMessage(styleKey) {
  const selected = CONSTRUCTION_STYLES[styleKey];
  return `Masonry style set to ${selected?.label ?? styleKey}.`;
}

export class ConstructionInspector {
  constructor({ host, controller, materialStore = null, onStatus = null }) {
    if (!host) throw new Error('ConstructionInspector needs a host element.');
    this.host = host;
    this.controller = controller;
    this.materialStore = materialStore;
    this.onStatus = onStatus;
    this.constructionId = null;

    this.element = document.createElement('aside');
    this.element.className = 'construction-inspector';
    this.element.hidden = true;
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-label', 'Wall properties');
    this.host.append(this.element);

    this.boundClick = (event) => this.handleClick(event);
    this.boundChange = (event) => this.handleChange(event);
    this.element.addEventListener('click', this.boundClick);
    this.element.addEventListener('change', this.boundChange);
    this.unsubscribeStore = controller.constructionStore?.subscribe(change => {
      if (!this.isOpen) return;
      if (change.id !== this.constructionId && !['replace', 'clear'].includes(change.kind)) return;
      if (!controller.constructionStore.get(this.constructionId)) this.close();
      else if (['history', 'replace'].includes(change.kind)) this.open(this.constructionId);
    });
  }

  get isOpen() {
    return !this.element.hidden;
  }

  open(constructionId) {
    const record = this.controller.constructionStore?.get(constructionId);
    if (!record) return;
    this.constructionId = constructionId;
    this.controller.setSelectedConstruction?.(constructionId);
    const styles = constructionStyleOptionsMarkup(record.style.key);
    this.materialPresets = wallMaterialPresets(this.materialStore?.document);
    const materials = wallMaterialOptionsMarkup(this.materialPresets, record.style.materials?.stone ?? null);
    this.element.innerHTML = `
      <header>
        <strong>${escapeText(record.label ?? 'Wall')}</strong>
        <button type="button" data-inspector-action="close" aria-label="Close">×</button>
      </header>
      <label>Height
        <input type="number" data-inspector-field="height" min="0.5" max="30" step="0.1"
          value="${record.dimensions.height}">
      </label>
      <label>Thickness
        <input type="number" data-inspector-field="thickness" min="0.1" max="10" step="0.05"
          value="${record.dimensions.thickness}">
      </label>
      <label>Masonry style
        <select data-inspector-field="style">${styles}</select>
      </label>
      <label>Material
        <select data-inspector-field="material">${materials}</select>
      </label>
      ${CONSTRUCTION_GROWTH_PROFILES[record.style.key] ? `<label>Ground growth
        <select data-inspector-field="growth">
          <option value="auto"${record.style.growth !== 'none' ? ' selected' : ''}>Natural</option>
          <option value="none"${record.style.growth === 'none' ? ' selected' : ''}>None</option>
        </select>
      </label>` : ''}
      <button class="construction-inspector-match" type="button" data-inspector-action="match">
        Draw matching wall
      </button>
    `;
    this.element.hidden = false;
  }

  close() {
    if (!this.isOpen) return;
    this.element.hidden = true;
    this.element.innerHTML = '';
    this.constructionId = null;
  }

  handleClick(event) {
    if (event.target.closest('[data-inspector-action="match"]')) {
      const id = this.constructionId;
      if (this.controller.drawMatchingConstruction(id)) {
        this.close();
        this.onStatus?.('Draw another wall with this look.');
      }
      return;
    }
    if (event.target.closest('[data-inspector-action="close"]')) this.close();
  }

  handleChange(event) {
    if (!this.constructionId) return;
    const field = event.target.dataset.inspectorField;
    if (!field) return;
    if (field === 'growth') {
      this.controller.runConstructionCommand({ type: 'set_growth',
        constructionId: this.constructionId, growth: event.target.value });
      this.onStatus?.(event.target.value === 'none' ? 'Ground growth removed.' : 'Natural ground growth restored.');
      return;
    }
    if (field === 'material') {
      if (!event.target.value) return;
      this.controller.runConstructionCommand({
        type: 'set_material',
        constructionId: this.constructionId,
        materials: { stone: event.target.value },
      });
      const preset = this.materialPresets?.find(({ id }) => id === event.target.value);
      this.onStatus?.(`Applied ${preset?.label ?? event.target.value}.`);
      return;
    }
    if (field === 'style') {
      this.controller.runConstructionCommand({
        type: 'set_style',
        constructionId: this.constructionId,
        styleKey: event.target.value,
      });
      this.onStatus?.(masonryStyleStatusMessage(event.target.value));
      this.open(this.constructionId);
      return;
    }
    const value = Number(event.target.value);
    if (!Number.isFinite(value)) return;
    this.controller.runConstructionCommand({
      type: 'set_dimensions',
      constructionId: this.constructionId,
      dimensions: { [field]: value },
    });
    this.onStatus?.(`Wall ${field} set to ${value}.`);
  }

  dispose() {
    this.unsubscribeStore?.();
    this.element.removeEventListener('click', this.boundClick);
    this.element.removeEventListener('change', this.boundChange);
    this.element.remove();
  }
}

function escapeText(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
