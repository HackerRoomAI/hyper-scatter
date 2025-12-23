/**
 * Spatial indexing helpers for fast hit-testing and lasso selection.
 *
 * Design goals:
 * - Deterministic and exact (matches reference semantics).
 * - No allocations in tight loops where practical.
 * - Works for both Euclidean and Poincaré datasets.
 */

import { pointInPolygon } from '../core/selection/point_in_polygon.js';
import { BitsetNumberSet } from '../core/selection/bitset_number_set.js';

interface Bounds2D {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function clampInt(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v | 0;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function computeBounds(positions: Float32Array): Bounds2D {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (let i = 0; i < positions.length; i += 2) {
    const x = positions[i];
    const y = positions[i + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }

  // Avoid degenerate ranges.
  const eps = 1e-9;
  if (Math.abs(maxX - minX) < eps) {
    maxX = minX + 1;
  }
  if (Math.abs(maxY - minY) < eps) {
    maxY = minY + 1;
  }

  return { minX, minY, maxX, maxY };
}

/**
 * Static uniform grid over a set of 2D points.
 *
 * This index is intended to be built once per dataset (data-space) and reused
 * across view changes. It supports fast AABB queries and radius queries.
 */
export class UniformGridIndex {
  readonly n: number;
  readonly bounds: Bounds2D;

  readonly cellsX: number;
  readonly cellsY: number;
  readonly cellSizeX: number;
  readonly cellSizeY: number;

  /** offsets.length = cellsX*cellsY + 1 */
  readonly offsets: Uint32Array;
  /** ids.length = n (point indices packed per cell) */
  readonly ids: Uint32Array;

  constructor(positions: Float32Array, bounds?: Bounds2D, targetPointsPerCell = 64) {
    this.n = (positions.length / 2) | 0;
    this.bounds = bounds ?? computeBounds(positions);

    const spanX = this.bounds.maxX - this.bounds.minX;
    const spanY = this.bounds.maxY - this.bounds.minY;

    // Choose cell count so average occupancy is ~targetPointsPerCell.
    // totalCells ~= n / target
    const totalCells = clamp(Math.ceil(this.n / Math.max(1, targetPointsPerCell)), 64, 1_000_000);

    // Split cells across axes proportionally to aspect ratio.
    const aspect = spanX / spanY;
    let cellsX = Math.round(Math.sqrt(totalCells * aspect));
    cellsX = clampInt(cellsX, 8, 2048);
    let cellsY = Math.round(totalCells / cellsX);
    cellsY = clampInt(cellsY, 8, 2048);

    this.cellsX = cellsX;
    this.cellsY = cellsY;
    this.cellSizeX = spanX / cellsX;
    this.cellSizeY = spanY / cellsY;

    const cellCount = cellsX * cellsY;
    const counts = new Uint32Array(cellCount);

    // 1) Count points per cell
    for (let i = 0; i < this.n; i++) {
      const x = positions[i * 2];
      const y = positions[i * 2 + 1];
      const cx = clampInt(Math.floor((x - this.bounds.minX) / this.cellSizeX), 0, cellsX - 1);
      const cy = clampInt(Math.floor((y - this.bounds.minY) / this.cellSizeY), 0, cellsY - 1);
      counts[cy * cellsX + cx]++;
    }

    // 2) Prefix sums to offsets
    const offsets = new Uint32Array(cellCount + 1);
    let acc = 0;
    for (let c = 0; c < cellCount; c++) {
      offsets[c] = acc;
      acc += counts[c];
    }
    offsets[cellCount] = acc;

    // 3) Fill ids via running cursor
    const cursor = offsets.slice(0, cellCount);
    const ids = new Uint32Array(this.n);
    for (let i = 0; i < this.n; i++) {
      const x = positions[i * 2];
      const y = positions[i * 2 + 1];
      const cx = clampInt(Math.floor((x - this.bounds.minX) / this.cellSizeX), 0, cellsX - 1);
      const cy = clampInt(Math.floor((y - this.bounds.minY) / this.cellSizeY), 0, cellsY - 1);
      const cell = cy * cellsX + cx;
      const dst = cursor[cell]++;
      ids[dst] = i;
    }

    this.offsets = offsets;
    this.ids = ids;
  }

  /**
   * Iterate all point ids in cells overlapping the given AABB.
   *
   * This avoids allocating or filling a potentially enormous `out` array.
   * It is especially important for large-N lasso selection benchmarks where
   * the polygon AABB can cover many cells.
   */
  forEachInAABB(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    visit: (id: number) => void
  ): void {
    const eps = 1e-12;
    minX -= eps; minY -= eps; maxX += eps; maxY += eps;

    const cx0 = clampInt(Math.floor((minX - this.bounds.minX) / this.cellSizeX), 0, this.cellsX - 1);
    const cy0 = clampInt(Math.floor((minY - this.bounds.minY) / this.cellSizeY), 0, this.cellsY - 1);
    const cx1 = clampInt(Math.floor((maxX - this.bounds.minX) / this.cellSizeX), 0, this.cellsX - 1);
    const cy1 = clampInt(Math.floor((maxY - this.bounds.minY) / this.cellSizeY), 0, this.cellsY - 1);

    for (let cy = cy0; cy <= cy1; cy++) {
      const rowBase = cy * this.cellsX;
      for (let cx = cx0; cx <= cx1; cx++) {
        const cell = rowBase + cx;
        const start = this.offsets[cell];
        const end = this.offsets[cell + 1];
        for (let k = start; k < end; k++) {
          visit(this.ids[k]);
        }
      }
    }
  }

  queryRadius(x: number, y: number, r: number, out: number[]): void {
    out.length = 0;
    this.forEachInAABB(x - r, y - r, x + r, y + r, (id) => out.push(id));
  }
}

export function lassoSelectIndexed(
  positions: Float32Array,
  polygonDataSpace: Float32Array,
  index: UniformGridIndex
): Set<number> {
  const n = (positions.length / 2) | 0;

  // For huge datasets, a JS Set can OOM if the lasso selects millions of points.
  // Use a bitset-backed Set implementation instead.
  const result: Set<number> = n >= 2_000_000
    ? new BitsetNumberSet(n)
    : new Set<number>();

  const nPoly = polygonDataSpace.length / 2;
  if (nPoly < 3) return result;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < polygonDataSpace.length; i += 2) {
    const x = polygonDataSpace[i];
    const y = polygonDataSpace[i + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  // For very large datasets, avoid building a huge candidates list.
  // Iterate overlapping cells directly.
  index.forEachInAABB(minX, minY, maxX, maxY, (i) => {
    const x = positions[i * 2];
    const y = positions[i * 2 + 1];
    if (x < minX || x > maxX || y < minY || y > maxY) return;
    if (pointInPolygon(x, y, polygonDataSpace)) {
      result.add(i);
    }
  });

  return result;
}
