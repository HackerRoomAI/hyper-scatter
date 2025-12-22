/**
 * Benchmark Utilities
 *
 * Shared utilities for timing, statistics, and comparison.
 */

// ============================================================================
// Timing Utilities
// ============================================================================

export interface TimingStats {
  min: number;
  max: number;
  avg: number;
  median: number;
  stdDev: number;
  samples: number;
}

/**
 * Calculate statistics from an array of timing samples.
 */
export function calculateStats(samples: number[]): TimingStats {
  if (samples.length === 0) {
    return { min: 0, max: 0, avg: 0, median: 0, stdDev: 0, samples: 0 };
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const sum = samples.reduce((a, b) => a + b, 0);
  const avg = sum / samples.length;

  const squaredDiffs = samples.map(x => (x - avg) ** 2);
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / samples.length;

  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg,
    median: sorted[Math.floor(sorted.length / 2)],
    stdDev: Math.sqrt(variance),
    samples: samples.length,
  };
}

/**
 * Measure execution time of a synchronous function.
 */
export function measureSync<T>(fn: () => T): { result: T; timeMs: number } {
  const start = performance.now();
  const result = fn();
  const timeMs = performance.now() - start;
  return { result, timeMs };
}

/**
 * Measure execution time of an async function.
 */
export async function measureAsync<T>(fn: () => Promise<T>): Promise<{ result: T; timeMs: number }> {
  const start = performance.now();
  const result = await fn();
  const timeMs = performance.now() - start;
  return { result, timeMs };
}

/**
 * Run a function multiple times and collect timing statistics.
 */
export function benchmark(
  fn: () => void,
  iterations: number,
  warmupIterations = 3
): TimingStats {
  // Warmup
  for (let i = 0; i < warmupIterations; i++) {
    fn();
  }

  // Measured iterations
  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    fn();
    samples.push(performance.now() - start);
  }

  return calculateStats(samples);
}

/**
 * Run a function multiple times with async gaps (for rendering benchmarks).
 */
export async function benchmarkAsync(
  fn: () => void,
  iterations: number,
  warmupIterations = 3,
  delayMs = 0
): Promise<TimingStats> {
  // Warmup
  for (let i = 0; i < warmupIterations; i++) {
    fn();
    if (delayMs > 0) await sleep(delayMs);
  }

  // Measured iterations
  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    fn();
    samples.push(performance.now() - start);
    if (delayMs > 0) await sleep(delayMs);
  }

  return calculateStats(samples);
}

// ============================================================================
// Comparison Utilities
// ============================================================================

/**
 * Compare two numbers with tolerance.
 */
export function approxEqual(a: number, b: number, epsilon = 1e-10): boolean {
  return Math.abs(a - b) <= epsilon;
}

/**
 * Compare two Float32Arrays with tolerance.
 */
export function arraysApproxEqual(
  a: Float32Array,
  b: Float32Array,
  epsilon = 1e-6
): { equal: boolean; maxError: number; errorIndex: number } {
  if (a.length !== b.length) {
    return { equal: false, maxError: Infinity, errorIndex: -1 };
  }

  let maxError = 0;
  let errorIndex = -1;

  for (let i = 0; i < a.length; i++) {
    const error = Math.abs(a[i] - b[i]);
    if (error > maxError) {
      maxError = error;
      errorIndex = i;
    }
  }

  return {
    equal: maxError <= epsilon,
    maxError,
    errorIndex: maxError > epsilon ? errorIndex : -1,
  };
}

/**
 * Compare two Sets for equality.
 */
export function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) {
    if (!b.has(item)) return false;
  }
  return true;
}

// ============================================================================
// Formatting Utilities
// ============================================================================

/**
 * Format a number with appropriate precision.
 */
export function formatNumber(n: number, decimals = 2): string {
  if (n >= 1000000) {
    return (n / 1000000).toFixed(decimals) + 'M';
  }
  if (n >= 1000) {
    return (n / 1000).toFixed(decimals) + 'k';
  }
  return n.toFixed(decimals);
}

/**
 * Format timing stats as a string.
 */
export function formatStats(stats: TimingStats): string {
  return `avg=${stats.avg.toFixed(2)}ms, min=${stats.min.toFixed(2)}ms, max=${stats.max.toFixed(2)}ms, stdDev=${stats.stdDev.toFixed(2)}ms`;
}

/**
 * Format timing stats as a table row.
 */
export function formatStatsRow(label: string, stats: TimingStats): string {
  return `${label.padEnd(20)} | ${stats.avg.toFixed(2).padStart(8)}ms | ${stats.min.toFixed(2).padStart(8)}ms | ${stats.max.toFixed(2).padStart(8)}ms | ${stats.stdDev.toFixed(2).padStart(8)}ms`;
}

// ============================================================================
// Helper Utilities
// ============================================================================

/**
 * Sleep for a given number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Wait for next animation frame (browser only).
 */
export function nextFrame(): Promise<number> {
  return new Promise(resolve => requestAnimationFrame(resolve));
}

/**
 * Generate a test polygon (square) for lasso selection benchmarks.
 */
export function generateTestPolygon(
  centerX: number,
  centerY: number,
  size: number
): Float32Array {
  const halfSize = size / 2;
  return new Float32Array([
    centerX - halfSize, centerY - halfSize,
    centerX + halfSize, centerY - halfSize,
    centerX + halfSize, centerY + halfSize,
    centerX - halfSize, centerY + halfSize,
  ]);
}

/**
 * Generate a complex polygon (star) for lasso selection benchmarks.
 */
export function generateStarPolygon(
  centerX: number,
  centerY: number,
  outerRadius: number,
  innerRadius: number,
  points: number
): Float32Array {
  const coords: number[] = [];
  for (let i = 0; i < points * 2; i++) {
    const angle = (i * Math.PI) / points - Math.PI / 2;
    const radius = i % 2 === 0 ? outerRadius : innerRadius;
    coords.push(centerX + Math.cos(angle) * radius);
    coords.push(centerY + Math.sin(angle) * radius);
  }
  return new Float32Array(coords);
}
