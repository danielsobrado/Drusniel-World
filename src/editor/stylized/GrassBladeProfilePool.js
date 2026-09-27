import { resolveAssetUrl } from '../assets/assetUrl.js';
import {
  describeProfileSets,
  resolveProfileSet,
} from './grassBladeProfiles.js';

/**
 * The blade silhouettes the whole grass field is currently wearing.
 *
 * One pool serves all 49 grass slots. Slots read it through a provider and compare
 * `revision`, so switching sets is a single assignment here plus each slot noticing
 * on its next update — no walk over the slots, and no second rebuild path beside
 * the allocate-on-demand one they already have.
 *
 * The manifest is a build artifact of `scripts/extract-grass-blade-profiles.mjs`.
 * A missing or stale one is not fatal: every set falls back to the generated taper,
 * which is a duller field but a field.
 */
export class GrassBladeProfilePool {
  constructor({ config, nearSegments, farSegments }) {
    this.config = config;
    this.nearSegments = nearSegments;
    this.farSegments = farSegments;
    this.manifest = null;
    this.manifestError = null;
    this.setId = config.bladeProfiles?.set ?? 'generated';
    this.revision = 0;
    this.resolved = new Map();
    this.resolvedRevision = -1;
  }

  get sets() {
    return this.config.bladeProfiles?.sets ?? {};
  }

  get biomeSets() {
    return this.config.bladeProfiles?.biomeSets?.byTileId ?? {};
  }

  async load(baseUrl = '') {
    const url = this.config.bladeProfiles?.manifest;
    if (!url) return;
    try {
      const response = await fetch(resolveAssetUrl(baseUrl, url));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const manifest = await response.json();
      if (!Array.isArray(manifest?.profiles)) throw new Error('manifest has no profiles array');
      this.manifest = manifest;
      this.manifestError = null;
    } catch (error) {
      this.manifestError = error;
      console.warn(
        `Grass blade profiles could not be loaded from ${url}; falling back to the generated taper. `
        + 'Run `npm run extract:grass-profiles` to bake them.',
        error,
      );
    }
    this.resolve();
  }

  resolve() {
    this.revision += 1;
    this.resolved.clear();
    this.resolvedRevision = -1;
  }

  /** Returns false when the set is already active, so a repeated UI selection does
   *  not cost every resident chunk a geometry rebuild. */
  select(setId) {
    if (setId === this.setId) return false;
    if (!this.sets[setId]) return false;
    this.setId = setId;
    this.resolve();
    return true;
  }

  /**
   * Which set a chunk standing mostly on `tileId` wears.
   *
   * A biome boundary crosses a chunk for free, so this is the chunk's majority
   * biome rather than a boundary-accurate answer: a reed bed decides the shape of
   * the meadow it spills into about as often as the other way round. The point is
   * that wetland grass is a reed and tundra grass is not, not that the seam lands
   * in the right place.
   */
  setForTile(tileId) {
    if (tileId === null || tileId === undefined) return this.setId;
    const mapped = this.biomeSets[tileId];
    return mapped && this.sets[mapped] ? mapped : this.setId;
  }

  /**
   * The resampled near and far bands for one set, resolved once and kept until the
   * manifest or the selection changes. Chunks are the ones that rebuild, so a set
   * shared by many chunks is only ever resolved once.
   */
  forSet(setId = this.setId) {
    if (this.resolvedRevision !== this.revision) {
      this.resolved.clear();
      this.resolvedRevision = this.revision;
    }
    let entry = this.resolved.get(setId);
    if (!entry) {
      const shared = { manifest: this.manifest, sets: this.sets, setId };
      entry = {
        setId,
        revision: this.revision,
        near: resolveProfileSet({ ...shared, segments: this.nearSegments }),
        far: resolveProfileSet({ ...shared, segments: this.farSegments }),
      };
      this.resolved.set(setId, entry);
    }
    return entry;
  }

  /** What a Settings control needs to render itself and report what it switched to. */
  describe() {
    return {
      setId: this.setId,
      manifestLoaded: Boolean(this.manifest),
      manifestError: this.manifestError ? String(this.manifestError.message ?? this.manifestError) : null,
      activeProfiles: this.forSet().near.map((profile) => profile.id),
      biomeSets: { ...this.biomeSets },
      sets: describeProfileSets({ manifest: this.manifest, sets: this.sets }),
    };
  }
}
