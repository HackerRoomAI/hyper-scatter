/**
 * Deterministic dataset generation for testing.
 */

import { Dataset, GeometryMode } from './types.js';
import { SeededRNG } from './rng.js';

export interface DatasetConfig {
  seed: number;
  n: number;
  labelCount: number;
  geometry: GeometryMode;
  /** Controls the spatial distribution of generated points. */
  distribution?: DatasetDistribution;
  /** For hyperbolic: generate points near boundary (stress test) */
  boundaryStress?: boolean;
}

export type DatasetDistribution =
  | 'default'
  | 'clustered';

// For very large-N benchmarks we want determinism but also *reasonable* setup time.
// Dataset generation is not the performance target of this project; rendering and
// interaction are. For N in the multi-millions, avoid per-point trig/log-heavy
// sampling where possible.
const FAST_PATH_THRESHOLD_N = 2_000_000;

function gaussianFastApprox(rng: SeededRNG, mean = 0, std = 1): number {
  // Irwin–Hall approximation: sum of uniforms approximates a normal.
  // Using 6 uniforms is a good speed/quality tradeoff.
  // Output has mean 0, variance 0.5 -> std ~0.707; we rescale to unit std.
  const u =
    rng.random() + rng.random() + rng.random() +
    rng.random() + rng.random() + rng.random();
  const z = (u - 3.0) * 1.4142135623730951; // sqrt(2)
  return mean + z * std;
}

function fillPoincareClusterCentersRandom(
  rng: SeededRNG,
  labelCount: number,
  outCx: Float32Array,
  outCy: Float32Array,
  outJitterStd: Float32Array,
): void {
  // Random cluster centers inside disk with area-uniform radius.
  // We still scale jitter by (1-|center|^2)/2 to keep clusters visually
  // comparable in hyperbolic units.
  const hyperbolicStd = 0.30;

  for (let label = 0; label < labelCount; label++) {
    const r = Math.sqrt(rng.random()) * 0.92;
    const theta = rng.range(0, 2 * Math.PI);
    const cx = r * Math.cos(theta);
    const cy = r * Math.sin(theta);
    outCx[label] = cx;
    outCy[label] = cy;
    const r2 = cx * cx + cy * cy;
    outJitterStd[label] = hyperbolicStd * 0.5 * (1 - r2);
  }
}

/**
 * Generate a deterministic dataset.
 */
export function generateDataset(config: DatasetConfig): Dataset {
  const rng = new SeededRNG(config.seed);
  const positions = new Float32Array(config.n * 2);
  const labels = new Uint16Array(config.n);

  const fast = config.n >= FAST_PATH_THRESHOLD_N;

  const distribution: DatasetDistribution = config.distribution ?? 'default';

  if (config.geometry === 'euclidean') {
    // Generate clustered Euclidean data
    const clusterCenters: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < config.labelCount; i++) {
      clusterCenters.push({
        x: rng.range(-1, 1),
        y: rng.range(-1, 1),
      });
    }

    for (let i = 0; i < config.n; i++) {
      const label = rng.int(config.labelCount);
      const center = clusterCenters[label];

      // For huge N, avoid Box–Muller (log/cos/sqrt) per point.
      // The approximation keeps overall visual structure and determinism.
      const noiseX = fast ? gaussianFastApprox(rng, 0, 0.15) : rng.gaussian(0, 0.15);
      const noiseY = fast ? gaussianFastApprox(rng, 0, 0.15) : rng.gaussian(0, 0.15);
      positions[i * 2] = center.x + noiseX;
      positions[i * 2 + 1] = center.y + noiseY;
      labels[i] = label;
    }
  } else {
    // Generate Poincare disk data
    // Points must be inside the unit disk (|z| < 1)

    if (distribution === 'clustered') {
      const cx = new Float32Array(config.labelCount);
      const cy = new Float32Array(config.labelCount);
      const jitterStd = new Float32Array(config.labelCount);
      fillPoincareClusterCentersRandom(rng, config.labelCount, cx, cy, jitterStd);

      for (let i = 0; i < config.n; i++) {
        const label = rng.int(config.labelCount);
        const j = jitterStd[label];
        const noiseX = fast ? gaussianFastApprox(rng, 0, j) : rng.gaussian(0, j);
        const noiseY = fast ? gaussianFastApprox(rng, 0, j) : rng.gaussian(0, j);

        let x = cx[label] + noiseX;
        let y = cy[label] + noiseY;
        const rSq = x * x + y * y;
        if (rSq >= 1) {
          const invR = 0.999 / Math.sqrt(rSq);
          x *= invR;
          y *= invR;
        }

        positions[i * 2] = x;
        positions[i * 2 + 1] = y;
        labels[i] = label;
      }

      return {
        n: config.n,
        positions,
        labels,
        geometry: config.geometry,
      };
    }

    // For huge N, avoid sin/cos per point by sampling angle from a lookup table.
    // Deterministic (seeded) and close enough for stress/perf testing.
    const tableSize = fast ? 4096 : 0;
    const cosTable = tableSize ? new Float32Array(tableSize) : null;
    const sinTable = tableSize ? new Float32Array(tableSize) : null;
    if (tableSize && cosTable && sinTable) {
      for (let t = 0; t < tableSize; t++) {
        const theta = (t / tableSize) * 2 * Math.PI;
        cosTable[t] = Math.cos(theta);
        sinTable[t] = Math.sin(theta);
      }
    }

    for (let i = 0; i < config.n; i++) {
      const label = rng.int(config.labelCount);
      let r: number;

      if (config.boundaryStress) {
        // Stress test: many points near boundary
        r = rng.range(0.9, 0.999);
      } else {
        // Normal distribution: use sqrt for uniform area distribution
        // Then compress slightly to avoid exact boundary
        r = Math.sqrt(rng.random()) * 0.95;
      }

      if (tableSize && cosTable && sinTable) {
        const t = rng.int(tableSize);
        positions[i * 2] = r * cosTable[t];
        positions[i * 2 + 1] = r * sinTable[t];
      } else {
        const theta = rng.range(0, 2 * Math.PI);
        positions[i * 2] = r * Math.cos(theta);
        positions[i * 2 + 1] = r * Math.sin(theta);
      }
      labels[i] = label;
    }
  }

  return {
    n: config.n,
    positions,
    labels,
    geometry: config.geometry,
  };
}

/**
 * Standard test datasets.
 */
export const STANDARD_DATASETS = {
  euclidean_10k: { seed: 42, n: 10_000, labelCount: 10, geometry: 'euclidean' as const },
  euclidean_100k: { seed: 42, n: 100_000, labelCount: 10, geometry: 'euclidean' as const },
  euclidean_1m: { seed: 42, n: 1_000_000, labelCount: 10, geometry: 'euclidean' as const },
  poincare_10k: { seed: 42, n: 10_000, labelCount: 10, geometry: 'poincare' as const },
  poincare_100k: { seed: 42, n: 100_000, labelCount: 10, geometry: 'poincare' as const },
  poincare_boundary_stress: { seed: 42, n: 100_000, labelCount: 10, geometry: 'poincare' as const, boundaryStress: true },
};
