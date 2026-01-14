# Benchmark Suite for viz-lab

This benchmark suite validates correctness and measures performance of renderer implementations.

## Quick Start

```bash
# Run Node.js benchmarks (pure math, no browser)
npm run bench

# Run browser benchmarks (Canvas2D rendering)
npm run bench:browser
```

## Creating an Optimized Renderer

### Step 1: Understand the Renderer Interface

Your renderer must implement the `Renderer` interface from `src/core/types.ts`:

```typescript
interface Renderer {
  init(canvas: HTMLCanvasElement, opts: InitOptions): void;
  setDataset(dataset: Dataset): void;
  setView(view: ViewState): void;
  getView(): ViewState;
  render(): void;
  resize(width: number, height: number): void;
  setSelection(indices: Set<number>): void;
  getSelection(): Set<number>;
  setHovered(index: number): void;
  destroy(): void;

  // Interaction
  pan(deltaX: number, deltaY: number, modifiers: Modifiers): void;
  zoom(anchorX: number, anchorY: number, delta: number, modifiers: Modifiers): void;
  hitTest(screenX: number, screenY: number): HitResult | null;
  lassoSelect(polyline: Float32Array): SelectionResult;

  // Coordinate transforms
  projectToScreen(dataX: number, dataY: number): { x: number; y: number };
  unprojectFromScreen(screenX: number, screenY: number): { x: number; y: number };
}
```

### SelectionResult Contract

The `lassoSelect()` method returns a `SelectionResult`:

```typescript
interface SelectionResult {
  kind: 'indices' | 'geometry';
  indices?: Set<number>;           // For kind === 'indices'
  geometry?: SelectionGeometry;    // For kind === 'geometry'
  computeTimeMs: number;
  has(index: number): boolean;     // Required for all kinds
}
```

Implementations may return either:
- **`kind: 'indices'`**: Direct set of selected point indices
- **`kind: 'geometry'`**: Selection polygon in data coordinates with lazy `has()` evaluation

The `has()` method is required for correctness verification. The harness uses it to test
membership for all points, allowing implementations flexibility in how they represent
selections internally (e.g., GPU-based geometry predicates instead of index enumeration).

Use the helper functions to create properly-formed results:
- `createIndicesSelectionResult(indices, computeTimeMs)` - for index-based selections
- `createGeometrySelectionResult(geometry, positions, computeTimeMs, pointInPolygonFn)` - for geometry-based

### Step 2: Use Reference Implementations as Ground Truth

Study the reference implementations in `src/impl_reference/`:
- `euclidean_reference.ts` - Euclidean geometry (simple pan/zoom)
- `hyperbolic_reference.ts` - Poincaré disk (Möbius transforms)

These are naive but correct. Your optimized version must produce identical results.

### Step 3: Create Your Candidate

Create your implementation in `src/impl_candidate/`:

```typescript
// src/impl_candidate/my_optimized_renderer.ts
import { Renderer, Dataset, ViewState, ... } from '../core/types.js';

export class MyOptimizedRenderer implements Renderer {
  // Implement all methods...
}
```

### Step 4: Run Node Benchmarks First

Before testing rendering, validate your math is correct:

```bash
npm run bench
```

Check for:
- **Möbius transform roundtrip**: Should be < 1e-15
- **Projection roundtrip**: Should be ~0 or < 1e-10
- **Pan anchor invariance**: PASS
- **Zoom anchor invariance**: PASS
- **Boundary camera test**: PASS (camera stays inside disk)

### Step 5: Integrate Into Browser Tests

Edit `src/benchmarks/browser.ts` to use your candidate:

```typescript
// Around line 305, change candidateRenderer:
import { MyOptimizedRenderer } from '../impl_candidate/my_optimized_renderer.js';

const candidateRenderer: Renderer = geometry === 'euclidean'
  ? new EuclideanReference()
  : new MyOptimizedRenderer();  // <-- Your implementation
```

### Step 6: Run Accuracy Tests

```bash
npm run bench:browser
```

1. Click **"Run Accuracy Tests"**
2. Check the **Accuracy Tests** tab

All tests should show `[PASS]`. If any fail, the report shows:
- Which operation failed (projection, pan, zoom, hitTest, lasso)
- The error magnitude
- Expected vs actual values

### Step 7: Run Performance Benchmarks

Once accuracy passes:

1. Edit `runSingleBenchmark()` in `browser.ts` to use your renderer
2. Click **"Run Performance Benchmark"**
3. Compare FPS at different point counts

Target: **20M points at 60 FPS**

## Expected Tolerances

| Operation | Tolerance | Notes |
|-----------|-----------|-------|
| Projection | < 1e-6 pixels | Screen coordinate match |
| Unprojection | < 1e-6 data units | Data coordinate match |
| Pan view state | < 1e-10 | Machine precision |
| Zoom view state | < 1e-10 | Machine precision |
| Hit test | Exact | Same point index |
| Lasso select | Exact | Verified via `has()` membership test for all points |

For boundary edge cases (points near |z| = 1), tolerance is relaxed to 1e-5.

## Harness Design Philosophy

The benchmark harness is intentionally implementation-agnostic:

- **Consistent test conditions**: The lasso polygon size is fixed (40% of canvas) regardless
  of point count. Implementations must handle large selections efficiently.
- **Contract-based verification**: Accuracy is verified via the `has()` method, not by
  comparing internal data structures. This allows implementations to use indices, bitsets,
  geometry predicates, or GPU-based solutions.
- **End-to-end lasso timing**: The browser performance benchmark reports lasso time including
  the work required to obtain an exact selected-count (i.e., it materializes counts for
  geometry/predicate selections). This avoids misleadingly low lasso times when expensive
  membership work is deferred.
- **No implementation hints**: The harness does not adapt its behavior based on point count
  or suggest specific optimization strategies.

## Iteration Workflow

```
┌─────────────────────────────────────────────────────────────┐
│  1. Make changes to your renderer                           │
├─────────────────────────────────────────────────────────────┤
│  2. npm run bench                                           │
│     └─ Fix any math errors (roundtrip, pan/zoom accuracy)   │
├─────────────────────────────────────────────────────────────┤
│  3. npm run bench:browser → Run Accuracy Tests              │
│     └─ Fix any rendering/interaction mismatches             │
├─────────────────────────────────────────────────────────────┤
│  4. npm run bench:browser → Run Performance Benchmark       │
│     └─ Measure FPS improvement                              │
├─────────────────────────────────────────────────────────────┤
│  5. Repeat until 20M @ 60fps                                │
└─────────────────────────────────────────────────────────────┘
```

## Debugging Failed Tests

### Projection Mismatch
```
[FAIL] projectToScreen: maxError=2.34e-3
       ref=(400.5, 300.2) vs cand=(402.8, 300.2)
```
- Check your Möbius transform implementation
- Verify `displayZoom` is applied correctly
- Check Y-axis flip (screen Y is inverted)

### Pan Mismatch
```
[FAIL] pan: maxError=1.5e-2
       centerX: 0.123 vs 0.138
```
- Verify `startPan()` is called before `pan()`
- Check anchor-invariant pan logic
- For hyperbolic: verify `solveForCamera()` implementation

### Hit Test Mismatch
```
[FAIL] hitTest: ref=1234 vs cand=1235
```
- Usually a tie-breaker difference
- Check your distance calculation
- Verify culling matches (points outside disk)

### Lasso Mismatch
```
[FAIL] lassoSelect: Mismatch at index 1234; ref=523 points vs cand=521 points
```
- The harness tests every point using `has()` and reports the first mismatch index
- Check point-in-polygon algorithm
- Verify polyline is unprojected to data space correctly
- Edge case: points exactly on polygon boundary
- For geometry-based selections: verify the `has()` implementation matches reference behavior

## File Structure

```
src/benchmarks/
├── README.md          # This file
├── utils.ts           # Timing, comparison utilities
├── accuracy.ts        # Accuracy comparison functions
├── browser.ts         # Browser benchmarks (Canvas2D)
└── node-bench.ts      # Node.js benchmarks (pure math)

src/impl_reference/
├── euclidean_reference.ts   # Ground truth Euclidean
└── hyperbolic_reference.ts  # Ground truth Hyperbolic

src/impl_candidate/          # Your optimized implementations
└── (your files here)
```

## Key Hyperbolic Math

For the Poincaré disk model:

- **Möbius transform**: `T_a(z) = (z - a) / (1 - conj(a) * z)`
- **Inverse**: `T_a^{-1}(w) = (w + a) / (1 + conj(a) * w)`
- **Pan**: Solve for new camera `a'` such that anchor point stays under cursor
- **Zoom**: Scale `displayZoom`, then pan to keep anchor fixed

The reference implementation in `src/core/math/poincare.ts` has detailed comments.
