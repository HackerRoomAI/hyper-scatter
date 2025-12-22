/**
 * Browser Benchmark Script
 *
 * Tests Canvas2D rendering and interaction performance.
 * Used by benchmark.html
 *
 * ============================================================================
 * CANDIDATE INTEGRATION GUIDE
 * ============================================================================
 *
 * To test your optimized renderer candidate against the reference:
 *
 * 1. Create your candidate renderer implementing the `Renderer` interface
 *    from `src/core/types.ts`. See `impl_reference/` for examples.
 *
 * 2. Import your candidate in this file:
 *    ```typescript
 *    import { MyOptimizedRenderer } from '../impl_candidate/my_renderer.js';
 *    ```
 *
 * 3. In `runAccuracyBenchmarks()`, replace the candidateRenderer lines:
 *    ```typescript
 *    const candidateRenderer: Renderer = geometry === 'euclidean'
 *      ? new EuclideanReference()  // or your Euclidean candidate
 *      : new MyOptimizedRenderer();  // <-- Your hyperbolic candidate
 *    ```
 *
 * 4. Run `npm run bench:browser` and click "Run Accuracy Tests"
 *
 * 5. For performance comparison, modify `runSingleBenchmark()` to use
 *    your candidate instead of the reference.
 *
 * Expected tolerances:
 * - Projection: < 1e-6 pixels
 * - Pan/Zoom view state: < 1e-10 (machine precision)
 * - Hit test: exact match (same point index)
 * - Lasso: exact match (same set of indices)
 *
 * ============================================================================
 */

import { GeometryMode, Renderer } from '../core/types.js';
import { generateDataset } from '../core/dataset.js';
import { EuclideanReference } from '../impl_reference/euclidean_reference.js';
import { HyperbolicReference } from '../impl_reference/hyperbolic_reference.js';
import {
  TimingStats,
  calculateStats,
  nextFrame,
  sleep,
  generateTestPolygon,
} from './utils.js';
import {
  runAccuracyTests,
  AccuracyReport,
} from './accuracy.js';

// ============================================================================
// Types
// ============================================================================

export interface BenchmarkConfig {
  pointCounts: number[];
  geometries: GeometryMode[];
  warmupFrames: number;
  measuredFrames: number;
  hitTestSamples: number;
}

export interface BenchmarkResult {
  geometry: GeometryMode;
  points: number;
  datasetGenMs: number;
  renderMs: TimingStats;
  hitTestMs: TimingStats;
  lassoMs: number;
  lassoSelectedCount: number;
  memoryMB?: number;
}

export interface BenchmarkReport {
  timestamp: string;
  system: {
    userAgent: string;
    devicePixelRatio: number;
    canvasWidth: number;
    canvasHeight: number;
  };
  config: BenchmarkConfig;
  results: BenchmarkResult[];
  accuracyReports?: AccuracyReport[];
}

export type ProgressCallback = (message: string, progress: number) => void;

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULT_CONFIG: BenchmarkConfig = {
  pointCounts: [1000, 10000, 50000, 100000, 250000, 500000, 1000000],
  geometries: ['euclidean', 'poincare'],
  warmupFrames: 5,
  measuredFrames: 20,
  hitTestSamples: 100,
};

// ============================================================================
// Benchmark Runner
// ============================================================================

/**
 * Run a single benchmark for a specific geometry and point count.
 */
async function runSingleBenchmark(
  canvas: HTMLCanvasElement,
  geometry: GeometryMode,
  pointCount: number,
  config: BenchmarkConfig,
  onProgress?: ProgressCallback
): Promise<BenchmarkResult> {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;

  onProgress?.(`Generating ${pointCount.toLocaleString()} ${geometry} points...`, 0);

  // Generate dataset
  const datasetStart = performance.now();
  const dataset = generateDataset({
    seed: 42,
    n: pointCount,
    labelCount: 10,
    geometry,
  });
  const datasetGenMs = performance.now() - datasetStart;

  // Create renderer
  const renderer: Renderer = geometry === 'euclidean'
    ? new EuclideanReference()
    : new HyperbolicReference();

  renderer.init(canvas, {
    width,
    height,
    devicePixelRatio: window.devicePixelRatio,
  });
  renderer.setDataset(dataset);

  onProgress?.(`Warming up render...`, 0.1);

  // Warmup renders
  for (let i = 0; i < config.warmupFrames; i++) {
    renderer.render();
    await nextFrame();
  }

  onProgress?.(`Measuring render performance...`, 0.3);

  // Measured render frames
  const renderTimes: number[] = [];
  for (let i = 0; i < config.measuredFrames; i++) {
    const start = performance.now();
    renderer.render();
    renderTimes.push(performance.now() - start);
    await nextFrame();
  }

  onProgress?.(`Measuring hit test performance...`, 0.6);

  // Hit test benchmark (random positions)
  const hitTestTimes: number[] = [];
  for (let i = 0; i < config.hitTestSamples; i++) {
    const x = Math.random() * width;
    const y = Math.random() * height;
    const start = performance.now();
    renderer.hitTest(x, y);
    hitTestTimes.push(performance.now() - start);
  }

  onProgress?.(`Measuring lasso selection...`, 0.8);

  // Lasso selection benchmark
  const lassoPolygon = generateTestPolygon(width / 2, height / 2, Math.min(width, height) * 0.4);
  const lassoResult = renderer.lassoSelect(lassoPolygon);

  // Memory usage (Chrome only)
  let memoryMB: number | undefined;
  if ('memory' in performance) {
    const mem = (performance as any).memory;
    memoryMB = mem.usedJSHeapSize / (1024 * 1024);
  }

  // Cleanup
  renderer.destroy();

  onProgress?.(`Completed ${geometry} ${pointCount.toLocaleString()}`, 1);

  return {
    geometry,
    points: pointCount,
    datasetGenMs,
    renderMs: calculateStats(renderTimes),
    hitTestMs: calculateStats(hitTestTimes),
    lassoMs: lassoResult.computeTimeMs,
    lassoSelectedCount: lassoResult.indices.size,
    memoryMB,
  };
}

/**
 * Run the full benchmark suite.
 */
export async function runBenchmarks(
  canvas: HTMLCanvasElement,
  config: BenchmarkConfig = DEFAULT_CONFIG,
  onProgress?: ProgressCallback
): Promise<BenchmarkReport> {
  const results: BenchmarkResult[] = [];
  const totalTests = config.pointCounts.length * config.geometries.length;
  let completedTests = 0;

  for (const geometry of config.geometries) {
    for (const pointCount of config.pointCounts) {
      onProgress?.(
        `Running ${geometry} ${pointCount.toLocaleString()}...`,
        completedTests / totalTests
      );

      try {
        const result = await runSingleBenchmark(
          canvas,
          geometry,
          pointCount,
          config,
          (msg, progress) => {
            const overallProgress = (completedTests + progress) / totalTests;
            onProgress?.(msg, overallProgress);
          }
        );
        results.push(result);
      } catch (error) {
        console.error(`Benchmark failed for ${geometry} ${pointCount}:`, error);
        // Continue with other tests
      }

      completedTests++;

      // Small delay between tests to let GC run
      await sleep(100);
    }
  }

  return {
    timestamp: new Date().toISOString(),
    system: {
      userAgent: navigator.userAgent,
      devicePixelRatio: window.devicePixelRatio,
      canvasWidth: canvas.clientWidth,
      canvasHeight: canvas.clientHeight,
    },
    config,
    results,
  };
}

/**
 * Run accuracy tests comparing reference implementations.
 *
 * CANDIDATE INTEGRATION: To test your optimized renderer, replace
 * `candidateRenderer` below with your implementation:
 *
 * ```typescript
 * import { MyOptimizedRenderer } from '../impl_candidate/my_renderer.js';
 *
 * const candidateRenderer: Renderer = geometry === 'euclidean'
 *   ? new EuclideanReference()    // or your Euclidean candidate
 *   : new MyOptimizedRenderer();  // <-- Your hyperbolic candidate
 * ```
 */
export async function runAccuracyBenchmarks(
  canvas: HTMLCanvasElement,
  onProgress?: ProgressCallback
): Promise<AccuracyReport[]> {
  const reports: AccuracyReport[] = [];
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;

  for (const geometry of ['euclidean', 'poincare'] as const) {
    onProgress?.(`Running ${geometry} accuracy tests...`, geometry === 'euclidean' ? 0 : 0.5);

    const dataset = generateDataset({
      seed: 42,
      n: 10000,
      labelCount: 10,
      geometry,
    });

    // Reference implementation (ground truth)
    const refRenderer: Renderer = geometry === 'euclidean'
      ? new EuclideanReference()
      : new HyperbolicReference();

    // Candidate implementation (change this to test your optimized renderer)
    // Currently comparing reference against itself to validate test infrastructure
    const candidateRenderer: Renderer = geometry === 'euclidean'
      ? new EuclideanReference()
      : new HyperbolicReference();

    refRenderer.init(canvas, { width, height, devicePixelRatio: window.devicePixelRatio });
    candidateRenderer.init(canvas, { width, height, devicePixelRatio: window.devicePixelRatio });

    const report = runAccuracyTests(
      refRenderer,
      candidateRenderer,
      dataset,
      width,
      height
    );

    reports.push(report);

    refRenderer.destroy();
    candidateRenderer.destroy();
  }

  return reports;
}

// ============================================================================
// Formatting
// ============================================================================

/**
 * Format benchmark results as a text table.
 */
export function formatResultsTable(report: BenchmarkReport): string {
  const lines: string[] = [
    '',
    '═'.repeat(100),
    'BENCHMARK RESULTS',
    '═'.repeat(100),
    `Timestamp: ${report.timestamp}`,
    `Canvas: ${report.system.canvasWidth}x${report.system.canvasHeight} @ ${report.system.devicePixelRatio}x DPR`,
    '─'.repeat(100),
    'Geometry   | Points     | Dataset  | Render (avg) | Render (min) | Hit Test   | Lasso      | Memory',
    '─'.repeat(100),
  ];

  for (const r of report.results) {
    const geo = r.geometry.padEnd(10);
    const pts = r.points.toLocaleString().padStart(10);
    const dgen = `${r.datasetGenMs.toFixed(1)}ms`.padStart(8);
    const ravg = `${r.renderMs.avg.toFixed(2)}ms`.padStart(12);
    const rmin = `${r.renderMs.min.toFixed(2)}ms`.padStart(12);
    const ht = `${r.hitTestMs.avg.toFixed(3)}ms`.padStart(10);
    const lasso = `${r.lassoMs.toFixed(2)}ms`.padStart(10);
    const mem = r.memoryMB ? `${r.memoryMB.toFixed(0)}MB`.padStart(7) : 'N/A'.padStart(7);

    lines.push(`${geo} | ${pts} | ${dgen} | ${ravg} | ${rmin} | ${ht} | ${lasso} | ${mem}`);
  }

  lines.push('═'.repeat(100));
  lines.push('');

  return lines.join('\n');
}

/**
 * Format benchmark results as HTML table.
 */
export function formatResultsHTML(report: BenchmarkReport): string {
  let html = `
    <table class="benchmark-table">
      <thead>
        <tr>
          <th>Geometry</th>
          <th>Points</th>
          <th>Dataset Gen</th>
          <th>Render (avg)</th>
          <th>Render (min)</th>
          <th>FPS</th>
          <th>Hit Test</th>
          <th>Lasso</th>
          <th>Memory</th>
        </tr>
      </thead>
      <tbody>
  `;

  for (const r of report.results) {
    const fps = (1000 / r.renderMs.avg).toFixed(1);
    const fpsClass = parseFloat(fps) >= 30 ? 'good' : parseFloat(fps) >= 10 ? 'warning' : 'bad';

    html += `
      <tr>
        <td>${r.geometry}</td>
        <td>${r.points.toLocaleString()}</td>
        <td>${r.datasetGenMs.toFixed(1)}ms</td>
        <td>${r.renderMs.avg.toFixed(2)}ms</td>
        <td>${r.renderMs.min.toFixed(2)}ms</td>
        <td class="${fpsClass}">${fps}</td>
        <td>${r.hitTestMs.avg.toFixed(3)}ms</td>
        <td>${r.lassoMs.toFixed(2)}ms</td>
        <td>${r.memoryMB ? r.memoryMB.toFixed(0) + 'MB' : 'N/A'}</td>
      </tr>
    `;
  }

  html += `
      </tbody>
    </table>
  `;

  return html;
}

// ============================================================================
// Export for global access in browser
// ============================================================================

// Attach to window for use in benchmark.html
if (typeof window !== 'undefined') {
  (window as any).VizBenchmark = {
    runBenchmarks,
    runAccuracyBenchmarks,
    formatResultsTable,
    formatResultsHTML,
    DEFAULT_CONFIG,
  };
}
