/**
 * The player's character, with the hero swappable at runtime.
 *
 * Presents the same surface as the views it wraps (`CharacterView`,
 * `GlbCharacterView`), so the composition root keeps one object for the whole
 * session. A swap never leaves the player without a body: the incoming hero is
 * loaded and compiled while the outgoing one stays on screen, and the two trade
 * places only once the new one is ready. If it fails to load, the current hero
 * simply stays.
 */

/** The procedural drow's stature (a 1.79 m base stretched by its profile). */
const PROCEDURAL_HERO_HEIGHT = 1.85;

export class SwitchableCharacterView {
  /**
   * @param {object} options
   * @param {(heroId: string) => object} options.createView builds a view for a hero id
   * @param {string} options.heroId the hero to start with
   */
  constructor({ createView, heroId }) {
    this._footstepListeners = new Set();
    this._relayFootstep = (event) => {
      for (const listener of this._footstepListeners) listener(event);
    };
    this.createView = (id) => {
      const view = createView(id);
      view.onFootstep?.(this._relayFootstep);
      return view;
    };
    this.heroId = heroId;
    this.active = this.createView(heroId);
    this._wantVisible = this.active.visible;
    this._compile = null;
    this._swap = null;
    this._disposed = false;
  }

  get visible() {
    return this.active.visible;
  }

  get stats() {
    return this.active.stats;
  }

  /** The active hero's height, metres; the procedural drow's when it has none. */
  get height() {
    return this.active.height ?? PROCEDURAL_HERO_HEIGHT;
  }

  /** Hero id being loaded to replace the current one, if any. */
  get pendingHeroId() {
    return this._swap?.heroId ?? null;
  }

  /**
   * Swap to another hero.
   * @returns {Promise<boolean>} whether the hero is now `heroId`
   */
  async setHero(heroId) {
    if (this._disposed) return false;
    if (heroId === this.heroId) {
      this._abandonSwap();
      return true;
    }
    if (this._swap?.heroId === heroId) return this._swap.promise;
    this._abandonSwap();

    const next = this.createView(heroId);
    next.setVisible(false);
    const swap = { heroId, view: next, abandoned: false, promise: null };
    this._swap = swap;
    const prepared = this._prepare(next).catch((error) => {
      console.error(`Hero "${heroId}" could not be prepared.`, error);
      return false;
    });
    swap.promise = prepared.then((ready) => {
      if (swap.abandoned || this._disposed || !ready) {
        // A failed load must not stay pending: picking the hero again retries.
        if (this._swap === swap) this._swap = null;
        next.dispose();
        return false;
      }
      const previous = this.active;
      this.active = next;
      this.heroId = heroId;
      this._swap = null;
      next.setVisible(this._wantVisible);
      previous.dispose();
      return true;
    });
    return swap.promise;
  }

  /** Resolves once `view` is loaded and compiled; false if it failed to load. */
  async _prepare(view) {
    if (view.ready) {
      // An authored view compiles on arrival when it already holds a compile request.
      if (this._compile) view.prewarm(this._compile.renderer, this._compile.camera);
      return view.ready;
    }
    if (this._compile) await view.prewarm(this._compile.renderer, this._compile.camera);
    return true;
  }

  _abandonSwap() {
    if (this._swap) this._swap.abandoned = true;
    this._swap = null;
  }

  update(dt, status, nowMs) {
    this.active.update(dt, status, nowMs);
  }

  /**
   * Hear the active hero's footfalls, across hero swaps. Heroes without
   * footfalls (the procedural drow) simply never call.
   * @returns {() => void} unsubscribe
   */
  onFootstep(listener) {
    this._footstepListeners.add(listener);
    return () => this._footstepListeners.delete(listener);
  }

  setVisible(visible) {
    this._wantVisible = Boolean(visible);
    this.active.setVisible(visible);
  }

  shiftWorld(shiftX, shiftZ) {
    this.active.shiftWorld(shiftX, shiftZ);
  }

  beginCast(durationMs, direction, nowMs) {
    this.active.beginCast(durationMs, direction, nowMs);
  }

  beginCastAlongCamera(durationMs, camera, nowMs) {
    this.active.beginCastAlongCamera(durationMs, camera, nowMs);
  }

  /** The active hero's breath source (GlbCharacterView.breathSource), or null. */
  breathSource() {
    return this.active.breathSource?.() ?? null;
  }

  handPosition(which, out) {
    return this.active.handPosition(which, out);
  }

  prewarm(renderer, camera) {
    this._compile = { renderer, camera };
    return this.active.prewarm(renderer, camera);
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this._abandonSwap();
    this.active.dispose();
  }
}
