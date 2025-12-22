/**
 * Node.js Benchmark Script
 *
 * Tests pure CPU operations without DOM/Canvas.
 * Run with: npx tsx src/benchmarks/node-bench.ts
 */

import { generateDataset } from '../core/dataset.js';
import {
  projectEuclidean,
  unprojectEuclidean,
  createEuclideanView,
} from '../core/math/euclidean.js';
import {
  projectPoincare,
  unprojectPoincare,
  createHyperbolicView,
  mobiusTransform,
  inverseMobiusTransform,
  mobiusAdd,
  hyperbolicDistance,
  panPoincare,
  zoomPoincare,
} from '../core/math/poincare.js';
import { lassoSelectBruteForce, pointInPolygon } from '../core/selection/point_in_polygon.js';
import { benchmark, generateTestPolygon } from './utils.js';

// ============================================================================
// Configuration
// ============================================================================

const POINT_COUNTS = [1_000, 10_000, 100_000, 1_000_000];
const ITERATIONS = 100;

// Canvas dimensions for projection benchmarks
const WIDTH = 1200;
const HEIGHT = 800;

// ============================================================================
// Benchmark Functions
// ============================================================================

function benchmarkDatasetGeneration(): void {
  console.log('\n' + '='.repeat(70));
  console.log('DATASET GENERATION BENCHMARK');
  console.log('='.repeat(70));
  console.log('Operation'.padEnd(30) + ' | ' + 'Avg'.padStart(10) + ' | ' + 'Min'.padStart(10) + ' | ' + 'Max'.padStart(10));
  console.log('-'.repeat(70));

  for (const n of POINT_COUNTS) {
    // Euclidean
    const eucStats = benchmark(
      () => generateDataset({ seed: 42, n, labelCount: 10, geometry: 'euclidean' }),
      Math.min(ITERATIONS, 20),
      3
    );
    console.log(`Euclidean ${n.toLocaleString().padStart(10)}`.padEnd(30) + ' | ' +
      `${eucStats.avg.toFixed(2)}ms`.padStart(10) + ' | ' +
      `${eucStats.min.toFixed(2)}ms`.padStart(10) + ' | ' +
      `${eucStats.max.toFixed(2)}ms`.padStart(10));

    // Poincare
    const poincareStats = benchmark(
      () => generateDataset({ seed: 42, n, labelCount: 10, geometry: 'poincare' }),
      Math.min(ITERATIONS, 20),
      3
    );
    console.log(`Poincare ${n.toLocaleString().padStart(10)}`.padEnd(30) + ' | ' +
      `${poincareStats.avg.toFixed(2)}ms`.padStart(10) + ' | ' +
      `${poincareStats.min.toFixed(2)}ms`.padStart(10) + ' | ' +
      `${poincareStats.max.toFixed(2)}ms`.padStart(10));
  }
}

function benchmarkProjections(): void {
  console.log('\n' + '='.repeat(70));
  console.log('PROJECTION MATH BENCHMARK (ops/sec)');
  console.log('='.repeat(70));

  const n = 100_000;
  const dataset = generateDataset({ seed: 42, n, labelCount: 10, geometry: 'euclidean' });
  const poincareDataset = generateDataset({ seed: 42, n, labelCount: 10, geometry: 'poincare' });

  const eucView = createEuclideanView();
  const hypView = createHyperbolicView();

  // Euclidean projection
  {
    const stats = benchmark(() => {
      for (let i = 0; i < n; i++) {
        projectEuclidean(dataset.positions[i * 2], dataset.positions[i * 2 + 1], eucView, WIDTH, HEIGHT);
      }
    }, 10, 3);
    const opsPerSec = (n * 1000) / stats.avg;
    console.log(`projectEuclidean:      ${opsPerSec.toExponential(2)} ops/sec (${stats.avg.toFixed(2)}ms for ${n.toLocaleString()} points)`);
  }

  // Euclidean unprojection
  {
    const stats = benchmark(() => {
      for (let i = 0; i < n; i++) {
        unprojectEuclidean(i % WIDTH, i % HEIGHT, eucView, WIDTH, HEIGHT);
      }
    }, 10, 3);
    const opsPerSec = (n * 1000) / stats.avg;
    console.log(`unprojectEuclidean:    ${opsPerSec.toExponential(2)} ops/sec (${stats.avg.toFixed(2)}ms for ${n.toLocaleString()} points)`);
  }

  // Poincare projection
  {
    const stats = benchmark(() => {
      for (let i = 0; i < n; i++) {
        projectPoincare(poincareDataset.positions[i * 2], poincareDataset.positions[i * 2 + 1], hypView, WIDTH, HEIGHT);
      }
    }, 10, 3);
    const opsPerSec = (n * 1000) / stats.avg;
    console.log(`projectPoincare:       ${opsPerSec.toExponential(2)} ops/sec (${stats.avg.toFixed(2)}ms for ${n.toLocaleString()} points)`);
  }

  // Poincare unprojection
  {
    const stats = benchmark(() => {
      for (let i = 0; i < n; i++) {
        unprojectPoincare(i % WIDTH, i % HEIGHT, hypView, WIDTH, HEIGHT);
      }
    }, 10, 3);
    const opsPerSec = (n * 1000) / stats.avg;
    console.log(`unprojectPoincare:     ${opsPerSec.toExponential(2)} ops/sec (${stats.avg.toFixed(2)}ms for ${n.toLocaleString()} points)`);
  }

  // Mobius transform (core hyperbolic op)
  {
    const stats = benchmark(() => {
      for (let i = 0; i < n; i++) {
        mobiusTransform(poincareDataset.positions[i * 2], poincareDataset.positions[i * 2 + 1], 0.3, 0.2);
      }
    }, 10, 3);
    const opsPerSec = (n * 1000) / stats.avg;
    console.log(`mobiusTransform:       ${opsPerSec.toExponential(2)} ops/sec (${stats.avg.toFixed(2)}ms for ${n.toLocaleString()} points)`);
  }

  // Inverse Mobius transform
  {
    const stats = benchmark(() => {
      for (let i = 0; i < n; i++) {
        inverseMobiusTransform(poincareDataset.positions[i * 2], poincareDataset.positions[i * 2 + 1], 0.3, 0.2);
      }
    }, 10, 3);
    const opsPerSec = (n * 1000) / stats.avg;
    console.log(`inverseMobiusTransform: ${opsPerSec.toExponential(2)} ops/sec (${stats.avg.toFixed(2)}ms for ${n.toLocaleString()} points)`);
  }

  // Mobius addition (gyroaddition)
  {
    const stats = benchmark(() => {
      for (let i = 0; i < n; i++) {
        mobiusAdd(poincareDataset.positions[i * 2], poincareDataset.positions[i * 2 + 1], 0.3, 0.2);
      }
    }, 10, 3);
    const opsPerSec = (n * 1000) / stats.avg;
    console.log(`mobiusAdd:             ${opsPerSec.toExponential(2)} ops/sec (${stats.avg.toFixed(2)}ms for ${n.toLocaleString()} points)`);
  }

  // Hyperbolic distance
  {
    const stats = benchmark(() => {
      for (let i = 0; i < n - 1; i++) {
        hyperbolicDistance(
          poincareDataset.positions[i * 2], poincareDataset.positions[i * 2 + 1],
          poincareDataset.positions[(i + 1) * 2], poincareDataset.positions[(i + 1) * 2 + 1]
        );
      }
    }, 10, 3);
    const opsPerSec = ((n - 1) * 1000) / stats.avg;
    console.log(`hyperbolicDistance:    ${opsPerSec.toExponential(2)} ops/sec (${stats.avg.toFixed(2)}ms for ${(n - 1).toLocaleString()} pairs)`);
  }
}

function benchmarkSelection(): void {
  console.log('\n' + '='.repeat(70));
  console.log('SELECTION BENCHMARK');
  console.log('='.repeat(70));

  // Test polygon (square in center)
  const polygon = generateTestPolygon(0, 0, 0.5);

  console.log('Point Counts'.padEnd(20) + ' | ' + 'pointInPolygon'.padStart(15) + ' | ' + 'lassoSelect'.padStart(15));
  console.log('-'.repeat(55));

  for (const n of POINT_COUNTS) {
    const dataset = generateDataset({ seed: 42, n, labelCount: 10, geometry: 'euclidean' });

    // Point in polygon test (single point, many iterations)
    const pipStats = benchmark(() => {
      for (let i = 0; i < 1000; i++) {
        pointInPolygon(dataset.positions[i * 2], dataset.positions[i * 2 + 1], polygon);
      }
    }, 100, 10);
    const pipOpsPerSec = (1000 * 1000) / pipStats.avg;

    // Full lasso selection
    const lassoStats = benchmark(
      () => lassoSelectBruteForce(dataset.positions, polygon),
      Math.min(50, Math.max(5, Math.floor(100000 / n))),
      3
    );

    console.log(
      `${n.toLocaleString().padStart(15)} pts`.padEnd(20) + ' | ' +
      `${pipOpsPerSec.toExponential(2)}/s`.padStart(15) + ' | ' +
      `${lassoStats.avg.toFixed(2)}ms`.padStart(15)
    );
  }
}

function benchmarkMathAccuracy(): void {
  console.log('\n' + '='.repeat(70));
  console.log('MATH ACCURACY CHECK (roundtrip errors)');
  console.log('='.repeat(70));

  const n = 1000;
  const poincareDataset = generateDataset({ seed: 42, n, labelCount: 10, geometry: 'poincare' });
  const hypView = createHyperbolicView();

  // Test Mobius transform roundtrip
  let maxMobiusError = 0;
  for (let i = 0; i < n; i++) {
    const x = poincareDataset.positions[i * 2];
    const y = poincareDataset.positions[i * 2 + 1];
    const transformed = mobiusTransform(x, y, 0.3, 0.2);
    const back = inverseMobiusTransform(transformed.x, transformed.y, 0.3, 0.2);
    const error = Math.sqrt((back.x - x) ** 2 + (back.y - y) ** 2);
    maxMobiusError = Math.max(maxMobiusError, error);
  }
  console.log(`Mobius transform roundtrip max error: ${maxMobiusError.toExponential(2)}`);

  // Test projection roundtrip
  let maxProjError = 0;
  for (let i = 0; i < n; i++) {
    const x = poincareDataset.positions[i * 2];
    const y = poincareDataset.positions[i * 2 + 1];
    const screen = projectPoincare(x, y, hypView, WIDTH, HEIGHT);
    const back = unprojectPoincare(screen.x, screen.y, hypView, WIDTH, HEIGHT);
    const error = Math.sqrt((back.x - x) ** 2 + (back.y - y) ** 2);
    maxProjError = Math.max(maxProjError, error);
  }
  console.log(`Poincare projection roundtrip max error: ${maxProjError.toExponential(2)}`);

  // Test Euclidean projection roundtrip
  const eucDataset = generateDataset({ seed: 42, n, labelCount: 10, geometry: 'euclidean' });
  const eucView = createEuclideanView();
  let maxEucProjError = 0;
  for (let i = 0; i < n; i++) {
    const x = eucDataset.positions[i * 2];
    const y = eucDataset.positions[i * 2 + 1];
    const screen = projectEuclidean(x, y, eucView, WIDTH, HEIGHT);
    const back = unprojectEuclidean(screen.x, screen.y, eucView, WIDTH, HEIGHT);
    const error = Math.sqrt((back.x - x) ** 2 + (back.y - y) ** 2);
    maxEucProjError = Math.max(maxEucProjError, error);
  }
  console.log(`Euclidean projection roundtrip max error: ${maxEucProjError.toExponential(2)}`);
}

function benchmarkPanZoomAccuracy(): void {
  console.log('\n' + '='.repeat(70));
  console.log('PAN/ZOOM ACCURACY CHECK (anchor invariance)');
  console.log('='.repeat(70));

  // Test: After panning, the point under the start position should be at the end position
  console.log('\n--- Pan Anchor Invariance Test ---');
  {
    const view = createHyperbolicView();

    // Pick a screen position and find what data point is there
    const startScreenX = WIDTH / 3;
    const startScreenY = HEIGHT / 3;
    const anchorData = unprojectPoincare(startScreenX, startScreenY, view, WIDTH, HEIGHT);

    // Pan from start to end
    const endScreenX = WIDTH / 2;
    const endScreenY = HEIGHT / 2;
    const newView = panPoincare(view, startScreenX, startScreenY, endScreenX, endScreenY, WIDTH, HEIGHT);

    // The anchor data point should now project to endScreen position
    const projectedAnchor = projectPoincare(anchorData.x, anchorData.y, newView, WIDTH, HEIGHT);
    const errorX = Math.abs(projectedAnchor.x - endScreenX);
    const errorY = Math.abs(projectedAnchor.y - endScreenY);
    const maxError = Math.max(errorX, errorY);

    console.log(`Pan anchor invariance error: ${maxError.toExponential(2)} pixels`);
    console.log(`  Status: ${maxError < 1e-6 ? 'PASS' : 'FAIL'}`);
  }

  // Test: Zoom anchor invariance (point under cursor stays there after zoom)
  console.log('\n--- Zoom Anchor Invariance Test ---');
  {
    const view = createHyperbolicView();

    // Pick an anchor screen position
    const anchorScreenX = WIDTH / 3;
    const anchorScreenY = HEIGHT / 3;
    const anchorData = unprojectPoincare(anchorScreenX, anchorScreenY, view, WIDTH, HEIGHT);

    // Zoom in at anchor
    const newView = zoomPoincare(view, anchorScreenX, anchorScreenY, 1.5, WIDTH, HEIGHT);

    // The anchor should still be at the same screen position
    const projectedAnchor = projectPoincare(anchorData.x, anchorData.y, newView, WIDTH, HEIGHT);
    const errorX = Math.abs(projectedAnchor.x - anchorScreenX);
    const errorY = Math.abs(projectedAnchor.y - anchorScreenY);
    const maxError = Math.max(errorX, errorY);

    console.log(`Zoom anchor invariance error: ${maxError.toExponential(2)} pixels`);
    console.log(`  Status: ${maxError < 1.0 ? 'PASS' : 'FAIL'}`); // Allow 1px tolerance for zoom
  }

  // Test: Multiple sequential pans should be equivalent to one large pan
  console.log('\n--- Sequential Pan Consistency Test ---');
  {
    const view = createHyperbolicView();

    // Sequential small pans
    let seqView = view;
    const startX = WIDTH / 2, startY = HEIGHT / 2;
    seqView = panPoincare(seqView, startX, startY, startX + 10, startY, WIDTH, HEIGHT);
    seqView = panPoincare(seqView, startX + 10, startY, startX + 20, startY, WIDTH, HEIGHT);
    seqView = panPoincare(seqView, startX + 20, startY, startX + 20, startY + 15, WIDTH, HEIGHT);

    // Test a sample point's projection
    const testDataX = 0.3, testDataY = -0.2;
    const seqProjected = projectPoincare(testDataX, testDataY, seqView, WIDTH, HEIGHT);

    // Single large pan (equivalent path)
    const singleView = panPoincare(view, startX, startY, startX + 20, startY + 15, WIDTH, HEIGHT);
    const singleProjected = projectPoincare(testDataX, testDataY, singleView, WIDTH, HEIGHT);

    // Note: Sequential pans may not exactly equal one large pan in hyperbolic space
    // because the intermediate positions affect the path. This is expected behavior.
    const errorX = Math.abs(seqProjected.x - singleProjected.x);
    const errorY = Math.abs(seqProjected.y - singleProjected.y);
    console.log(`Sequential vs single pan difference: (${errorX.toFixed(2)}, ${errorY.toFixed(2)}) pixels`);
    console.log(`  Note: Non-zero difference is expected in hyperbolic geometry`);
  }

  // Test: Boundary behavior (camera near disk edge)
  console.log('\n--- Boundary Camera Test ---');
  {
    let view = createHyperbolicView();

    // Pan aggressively toward boundary
    for (let i = 0; i < 20; i++) {
      view = panPoincare(view, WIDTH / 2, HEIGHT / 2, WIDTH / 2 + 30, HEIGHT / 2, WIDTH, HEIGHT);
    }

    // Check camera is still valid (|a| < 1)
    const cameraNorm = Math.sqrt(view.ax * view.ax + view.ay * view.ay);
    console.log(`Camera position after aggressive panning: (${view.ax.toFixed(4)}, ${view.ay.toFixed(4)})`);
    console.log(`Camera norm: ${cameraNorm.toFixed(6)}`);
    console.log(`  Status: ${cameraNorm < 1.0 ? 'PASS (inside disk)' : 'FAIL (outside disk)'}`);

    // Test projection still works
    const testScreen = projectPoincare(0, 0, view, WIDTH, HEIGHT);
    const hasValidProjection = isFinite(testScreen.x) && isFinite(testScreen.y);
    console.log(`  Projection valid: ${hasValidProjection ? 'PASS' : 'FAIL'}`);
  }
}

// ============================================================================
// Main
// ============================================================================

function main(): void {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║              VIZ-LAB NODE.JS BENCHMARK SUITE                         ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`Node version: ${process.version}`);
  console.log(`Platform: ${process.platform} ${process.arch}`);

  const startTime = performance.now();

  benchmarkDatasetGeneration();
  benchmarkProjections();
  benchmarkSelection();
  benchmarkMathAccuracy();
  benchmarkPanZoomAccuracy();

  const totalTime = performance.now() - startTime;
  console.log('\n' + '='.repeat(70));
  console.log(`Total benchmark time: ${(totalTime / 1000).toFixed(2)}s`);
  console.log('='.repeat(70) + '\n');
}

main();
