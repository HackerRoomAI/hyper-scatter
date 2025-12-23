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
  /** For hyperbolic: generate points near boundary (stress test) */
  boundaryStress?: boolean;
}

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

/**
 * Generate a deterministic dataset.
 */
export function generateDataset(config: DatasetConfig): Dataset {
  const rng = new SeededRNG(config.seed);
  const positions = new Float32Array(config.n * 2);
  const labels = new Uint16Array(config.n);

  const fast = config.n >= FAST_PATH_THRESHOLD_N;

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
