import { reachFalls, reachSurfaceAt } from './RiverReachProfile.js';

/** Side of the square buckets fall sites are indexed by, in metres. */
const BUCKET_METERS = 1024;

/**
 * Every river fall as a site in canonical world metres, for effects that
 * attach to falls (mist, sound). World X is cell X times the cell size; world
 * Z runs the other way from cell Z, as everywhere in canonical space.
 *
 * Each site: `x`, `z` the foot of the face at mid-channel; `lipX`, `lipZ` its
 * top; `top` and `foot` the water levels there; `dirX`, `dirZ` the downstream
 * direction; `widthMeters` the channel; `drop`; and `seed`, stable for a world.
 */
export function collectRiverFallSites(segments, cellSizeMeters) {
  const sites = [];
  segments.forEach((segment, segmentIndex) => {
    reachFalls(segment.profile).forEach((fall, fallIndex) => {
      const lipT = fall.lip;
      const footT = fall.foot;
      const cellAt = (t) => ({ x: segment.ax + segment.dx * t, z: segment.az + segment.dz * t });
      const lip = cellAt(lipT);
      const foot = cellAt(footT);
      sites.push(Object.freeze({
        x: foot.x * cellSizeMeters,
        z: -foot.z * cellSizeMeters,
        lipX: lip.x * cellSizeMeters,
        lipZ: -lip.z * cellSizeMeters,
        top: reachSurfaceAt(segment.profile, lipT),
        foot: reachSurfaceAt(segment.profile, footT),
        dirX: segment.flowX,
        dirZ: -segment.flowZ,
        widthMeters: segment.radiusCells * 2 * cellSizeMeters,
        drop: fall.drop,
        seed: (Math.imul(segmentIndex + 1, 0x9e3779b1) ^ Math.imul(fallIndex + 1, 0x85ebca6b)) >>> 0,
      }));
    });
  });
  return sites;
}

function bucketKey(x, z) {
  return `${Math.floor(x / BUCKET_METERS)}:${Math.floor(z / BUCKET_METERS)}`;
}

/** Fall sites bucketed on a coarse grid, for nearest-first queries around the camera. */
export class RiverFallSiteIndex {
  constructor(sites) {
    this.sites = sites;
    this.buckets = new Map();
    for (const site of sites) {
      const key = bucketKey(site.x, site.z);
      const bucket = this.buckets.get(key);
      if (bucket) bucket.push(site);
      else this.buckets.set(key, [site]);
    }
  }

  /** Sites within `radius` metres of a point, nearest first, at most `limit`. */
  near(x, z, radius, limit = Infinity) {
    const found = [];
    const minimumX = Math.floor((x - radius) / BUCKET_METERS);
    const maximumX = Math.floor((x + radius) / BUCKET_METERS);
    const minimumZ = Math.floor((z - radius) / BUCKET_METERS);
    const maximumZ = Math.floor((z + radius) / BUCKET_METERS);
    for (let bucketZ = minimumZ; bucketZ <= maximumZ; bucketZ += 1) {
      for (let bucketX = minimumX; bucketX <= maximumX; bucketX += 1) {
        for (const site of this.buckets.get(`${bucketX}:${bucketZ}`) ?? []) {
          const distance = Math.hypot(site.x - x, site.z - z);
          if (distance <= radius) found.push({ site, distance });
        }
      }
    }
    found.sort((left, right) => left.distance - right.distance);
    return found.slice(0, limit).map((entry) => entry.site);
  }
}

/**
 * A lazily rebuilt fall-site index for whatever world is loaded: rebuilt only
 * when the generator changes, and null for a world without river falls.
 */
export function createRiverFallSiteSource(getGenerator) {
  let generator;
  let index = null;
  return () => {
    const current = getGenerator();
    if (current === generator) return index;
    generator = current;
    const model = current?.waterTerrainModel;
    const sites = collectRiverFallSites(
      model?.riverChannel?.segments ?? [],
      model?.config?.cellSizeMeters ?? 1,
    );
    index = sites.length ? new RiverFallSiteIndex(sites) : null;
    return index;
  };
}
