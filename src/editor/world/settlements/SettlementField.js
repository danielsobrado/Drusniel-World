import { PlanGrid, rect, rectContains } from './SettlementGeometry.js';
import { planSettlement } from './SettlementPlanner.js';
import { settlementProfile } from './SettlementProfile.js';

/** Metres over which a flattened pad blends back into the natural ground. */
const PAD_BLEND = 3;
/** Ground kept clear (painted as street) round every footprint, in metres. */
const FOOTPRINT_CLEAR = 0.8;
const INDEX_BUCKET_METRES = 512;
/**
 * Coastal burgs often sit in the sea on the coarse terrain atlas, whose pixels
 * are kilometres wide on a planet-scale world. Such a burg is moved to the
 * nearest dry land: first in atlas-pixel steps (as the minimap snaps markers),
 * then refined locally until its centre stands on solid ground.
 */
const COARSE_LAND_RINGS = 3;
const FINE_LAND_SHIFT_METRES = 320;
const LAND_RING_METRES = 22;
const LAND_SHARE = 0.75;

function smoothstep(value) {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

/** Bearings, in plan space, at which the routes leave a circle round the burg. */
export function routeBearings(routes, center, radiusCells) {
  const bearings = [];
  for (const route of routes) {
    for (let index = 1; index < route.length; index += 1) {
      const [ax, az] = route[index - 1];
      const [bx, bz] = route[index];
      const da = Math.hypot(ax - center.cellX, az - center.cellZ) - radiusCells;
      const db = Math.hypot(bx - center.cellX, bz - center.cellZ) - radiusCells;
      if (Math.sign(da) === Math.sign(db) || da === db) continue;
      const t = da / (da - db);
      const x = ax + (bx - ax) * t - center.cellX;
      const z = az + (bz - az) * t - center.cellZ;
      bearings.push(Math.atan2(x, z));
    }
  }
  return bearings;
}

/**
 * Settlements laid into the terrain.
 *
 * Plans are made lazily the first time a query falls inside a settlement's
 * reach, and cached — so a terrain worker only ever plans the towns its chunks
 * touch. Two queries serve the generator: `cover` (street, square, walk or
 * footprint — drawn as the road tile, which also keeps grass and trees off it)
 * and `grade` (footprints flattened to their pad, blended at the edges).
 */
export class SettlementField {
  constructor({ settlements, tileSize, worldSeed, routes = [], sampleGround, isBuildable, landSearchStepCells = 0 }) {
    this.tileSize = tileSize;
    this.worldSeed = worldSeed;
    this.routes = routes;
    this.sampleGround = sampleGround;
    this.isBuildable = isBuildable;
    this.landSearchStepCells = landSearchStepCells;
    this.entries = settlements.flatMap((source) => {
      const settlement = this.onLand(source);
      if (!settlement) return [];
      return [{ settlement, reachCells: settlementProfile(settlement).reach / tileSize, plan: undefined, index: null }];
    });
    this.bucketCells = INDEX_BUCKET_METRES / tileSize;
    this.buckets = new Map();
    for (const entry of this.entries) {
      const { cellX, cellZ } = entry.settlement;
      const reach = entry.reachCells;
      for (let bx = Math.floor((cellX - reach) / this.bucketCells); bx <= Math.floor((cellX + reach) / this.bucketCells); bx += 1) {
        for (let bz = Math.floor((cellZ - reach) / this.bucketCells); bz <= Math.floor((cellZ + reach) / this.bucketCells); bz += 1) {
          const key = `${bx}:${bz}`;
          if (!this.buckets.has(key)) this.buckets.set(key, []);
          this.buckets.get(key).push(entry);
        }
      }
    }
  }

  entriesAt(cellX, cellZ) {
    return this.buckets.get(`${Math.floor(cellX / this.bucketCells)}:${Math.floor(cellZ / this.bucketCells)}`) ?? null;
  }

  /** Settlements whose reach touches a circle, with their plans. */
  near(cellX, cellZ, radiusCells) {
    const result = [];
    for (const entry of this.entries) {
      const distance = Math.hypot(entry.settlement.cellX - cellX, entry.settlement.cellZ - cellZ);
      if (distance <= radiusCells + entry.reachCells) result.push({ settlement: entry.settlement, plan: this.ensurePlan(entry).plan, distance });
    }
    return result.sort((left, right) => left.distance - right.distance);
  }

  /** Share of a small ring round a cell that is dry land. */
  landShare(cellX, cellZ) {
    if (!this.isBuildable(cellX, cellZ)) return 0;
    const radius = LAND_RING_METRES / this.tileSize;
    let dry = 0;
    for (let index = 0; index < 12; index += 1) {
      const angle = Math.PI * 2 * index / 12;
      if (this.isBuildable(cellX + Math.sin(angle) * radius, cellZ + Math.cos(angle) * radius)) dry += 1;
    }
    return dry / 12;
  }

  /** Nearest point on a ring search that satisfies `accept`, or null. */
  static ringSearch(origin, step, rings, accept) {
    for (let ring = 1; ring <= rings; ring += 1) {
      const samples = Math.max(8, ring * 8);
      let best = null;
      for (let index = 0; index < samples; index += 1) {
        const angle = Math.PI * 2 * index / samples;
        const cellX = origin.cellX + Math.sin(angle) * ring * step;
        const cellZ = origin.cellZ + Math.cos(angle) * ring * step;
        const score = accept(cellX, cellZ);
        if (score > 0 && (!best || score > best.score)) best = { cellX, cellZ, score };
      }
      if (best) return best;
    }
    return null;
  }

  /** The burg on solid ground, moved if its point is in water; null if no land is near. */
  onLand(settlement) {
    const solid = (cellX, cellZ) => {
      const share = this.landShare(cellX, cellZ);
      return share >= LAND_SHARE ? share : 0;
    };
    if (solid(settlement.cellX, settlement.cellZ)) return settlement;
    let origin = settlement;
    if (this.landSearchStepCells > 0 && !this.isBuildable(settlement.cellX, settlement.cellZ)) {
      const coarse = SettlementField.ringSearch(settlement, this.landSearchStepCells, COARSE_LAND_RINGS, (x, z) => (this.isBuildable(x, z) ? 1 : 0));
      if (!coarse) return null;
      origin = { cellX: coarse.cellX, cellZ: coarse.cellZ };
      if (solid(origin.cellX, origin.cellZ)) return { ...settlement, ...origin, shifted: true };
    }
    const fineStep = 16 / this.tileSize;
    const fine = SettlementField.ringSearch(origin, fineStep, Math.floor(FINE_LAND_SHIFT_METRES / 16), solid);
    return fine ? { ...settlement, cellX: fine.cellX, cellZ: fine.cellZ, shifted: true } : null;
  }

  ensurePlan(entry) {
    if (entry.plan !== undefined) return entry;
    const { settlement } = entry;
    const toCell = (x, z) => [settlement.cellX + x / this.tileSize, settlement.cellZ + z / this.tileSize];
    entry.plan = planSettlement({
      settlement,
      worldSeed: this.worldSeed,
      routeBearings: routeBearings(this.routes, settlement, settlementProfile(settlement).radius * 1.15 / this.tileSize),
      sampleHeight: (x, z) => this.sampleGround(...toCell(x, z)),
      isBuildable: (x, z) => this.isBuildable(...toCell(x, z)),
    });
    entry.index = indexPlan(entry.plan);
    return entry;
  }

  /** Plan-space position of a cell within an entry. */
  local(entry, cellX, cellZ) {
    return [(cellX - entry.settlement.cellX) * this.tileSize, (cellZ - entry.settlement.cellZ) * this.tileSize];
  }

  candidates(cellX, cellZ) {
    const bucket = this.entriesAt(cellX, cellZ);
    if (!bucket) return [];
    return bucket.filter((entry) => Math.hypot(cellX - entry.settlement.cellX, cellZ - entry.settlement.cellZ) <= entry.reachCells);
  }

  /** 1 on a street, square, walk or footprint; 0 elsewhere. */
  cover(cellX, cellZ) {
    for (const entry of this.candidates(cellX, cellZ)) {
      const { index } = this.ensurePlan(entry);
      const [x, z] = this.local(entry, cellX, cellZ);
      if (index.squareRadius > 0 && Math.hypot(x, z) <= index.squareRadius) return 1;
      for (const item of index.grid.near(x, z, 0)) {
        if (item.street) {
          if (item.distance(x, z) <= item.halfWidth) return 1;
        } else if (rectContains(item.box, x, z, FOOTPRINT_CLEAR)) {
          return 1;
        }
      }
    }
    return 0;
  }

  /** Blend `height` toward the pad of any footprint at or near this vertex. */
  grade(cellX, cellZ, height) {
    let result = height;
    for (const entry of this.candidates(cellX, cellZ)) {
      const { index } = this.ensurePlan(entry);
      const [x, z] = this.local(entry, cellX, cellZ);
      let weight = 0;
      let pad = 0;
      for (const item of index.grid.near(x, z, 0)) {
        if (item.street) continue;
        const dx = x - item.box.x;
        const dz = z - item.box.z;
        const outsideX = Math.max(0, Math.abs(dx * item.box.ax[0] + dz * item.box.ax[1]) - item.box.halfWidth);
        const outsideZ = Math.max(0, Math.abs(dx * item.box.az[0] + dz * item.box.az[1]) - item.box.halfDepth);
        const amount = smoothstep(1 - Math.hypot(outsideX, outsideZ) / PAD_BLEND);
        if (amount > weight) {
          weight = amount;
          pad = item.pad;
        }
      }
      if (weight > 0) result = result + (pad - result) * weight;
    }
    return result;
  }
}

function indexPlan(plan) {
  const grid = new PlanGrid(12);
  for (const building of plan.buildings) {
    const box = rect(building.x, building.z, building.width, building.depth, building.yaw);
    grid.insert({ box, pad: building.pad }, box.x, box.z, box.radius + PAD_BLEND);
  }
  for (const street of plan.streets) {
    for (let index = 1; index < street.points.length; index += 1) {
      const [ax, az] = street.points[index - 1];
      const [bx, bz] = street.points[index];
      const halfWidth = street.width / 2;
      const item = {
        street: true,
        halfWidth,
        distance(x, z) {
          const dx = bx - ax;
          const dz = bz - az;
          const lengthSquared = dx * dx + dz * dz || 1;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / lengthSquared));
          return Math.hypot(x - (ax + dx * t), z - (az + dz * t));
        },
      };
      const cx = (ax + bx) / 2;
      const cz = (az + bz) / 2;
      grid.insert(item, cx, cz, Math.hypot(bx - ax, bz - az) / 2 + halfWidth);
    }
  }
  return { grid, squareRadius: plan.squareRadius };
}
