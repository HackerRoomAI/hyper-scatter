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

/**
 * Generate a deterministic dataset.
 */
export function generateDataset(config: DatasetConfig): Dataset {
  const rng = new SeededRNG(config.seed);
  const positions = new Float32Array(config.n * 2);
  const labels = new Uint16Array(config.n);

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
      positions[i * 2] = center.x + rng.gaussian(0, 0.15);
      positions[i * 2 + 1] = center.y + rng.gaussian(0, 0.15);
      labels[i] = label;
    }
  } else {
    // Generate Poincare disk data
    // Points must be inside the unit disk (|z| < 1)
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

      const theta = rng.range(0, 2 * Math.PI);
      positions[i * 2] = r * Math.cos(theta);
      positions[i * 2 + 1] = r * Math.sin(theta);
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
