/**
 * Topbar picker for the hero the player walks as.
 *
 * A single labelled `<select>` beside the Edit / Player switcher. It releases
 * focus after every pick: the player controller reads movement keys from the
 * window, and a focused select would also turn W, A, S and D into picks.
 */

export class HeroSelectUi {
  /**
   * @param {object} options
   * @param {HTMLElement} options.root editor root holding the `.topbar`
   * @param {{ id: string, name: string, title?: string }[]} options.heroes
   * @param {string} options.heroId the hero shown as selected
   * @param {(heroId: string) => Promise<boolean>} options.onSelect
   */
  constructor({ root, heroes, heroId, onSelect }) {
    const topbar = root.querySelector('.topbar');
    if (!topbar) throw new Error('Hero select UI requires the editor topbar.');
    this.onSelect = onSelect;

    this.element = document.createElement('label');
    this.element.className = 'hero-select';
    this.element.title = 'Who the player walks as';
    const caption = document.createElement('span');
    caption.textContent = 'Hero';
    this.select = document.createElement('select');
    this.select.setAttribute('aria-label', 'Hero');
    for (const hero of heroes) {
      const option = document.createElement('option');
      option.value = hero.id;
      option.textContent = hero.title ? `${hero.name} — ${hero.title}` : hero.name;
      this.select.append(option);
    }
    this.element.append(caption, this.select);
    const switcher = topbar.querySelector('.view-mode-switcher');
    if (switcher) switcher.after(this.element);
    else topbar.prepend(this.element);

    this.current = heroId;
    this.select.value = heroId;
    this.onChange = () => this._pick(this.select.value);
    this.select.addEventListener('change', this.onChange);
  }

  async _pick(heroId) {
    this.select.blur();
    this.element.classList.add('is-loading');
    this.select.disabled = true;
    try {
      const swapped = await this.onSelect(heroId);
      if (swapped) this.current = heroId;
    } finally {
      this.select.value = this.current;
      this.select.disabled = false;
      this.element.classList.remove('is-loading');
    }
  }

  dispose() {
    this.select.removeEventListener('change', this.onChange);
    this.element.remove();
  }
}
