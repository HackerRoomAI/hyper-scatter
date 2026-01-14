# hyper-scatter

A correctness + performance lab for high-performance embedding scatterplots supporting both **Euclidean** and **Hyperbolic (Poincaré disk)** geometries.

**Target:** 20 million points at 60 FPS with geometry-aware interactions.

![Poincaré disk visualization](https://upload.wikimedia.org/wikipedia/commons/thumb/8/8d/Uniform_tiling_73-t2.png/240px-Uniform_tiling_73-t2.png)

## Why This Exists

Embedding visualizations (t-SNE, UMAP, etc.) commonly use Euclidean 2D scatterplots. But some embeddings—especially hierarchical or tree-like data—are better represented in **hyperbolic space**, where the Poincaré disk model can display exponentially more information near the boundary.

The challenge: hyperbolic geometry requires different math for camera navigation, hit-testing, and selection. Getting it wrong produces subtle bugs. Getting it fast requires GPU acceleration. This lab lets us do both.

## The Reference/Candidate Methodology

We develop renderers using a **two-implementation strategy**:

```
┌─────────────────────────────────────────────────────────────┐
│                     REFERENCE                               │
│  • Canvas2D (CPU)                                           │
│  • Naive but correct                                        │
│  • Ground truth for all operations                          │
│  • Easy to read and verify                                  │
└─────────────────────────────────────────────────────────────┘
                          ▼
              Accuracy tests compare behavior
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                     CANDIDATE                               │
│  • WebGL2 (GPU)                                             │
│  • Optimized for performance                                │
│  • Must match reference semantics exactly                   │
│  • Uses spatial indexing, adaptive quality, etc.            │
└─────────────────────────────────────────────────────────────┘
```

### Why This Works

1. **Correctness is verifiable**: Every operation (projection, pan, zoom, hit-test, lasso) can be compared against the reference.

2. **Optimization freedom**: The candidate can use any technique (GPU shaders, spatial indexes, LOD) as long as semantics match.

3. **Regression detection**: Performance benchmarks track FPS over time; accuracy tests catch behavioral drift.

4. **Geometry extensibility**: Adding a new geometry (e.g., spherical) means writing a new reference first, then optimizing.

## Supported Geometries

### Euclidean
Standard 2D scatterplot with pan/zoom. Simple, fast, well-understood.

### Poincaré Disk (Hyperbolic)
The Poincaré disk model maps the infinite hyperbolic plane onto a unit disk:
- Points near the center appear "normal"
- Points near the boundary are compressed (infinitely far in hyperbolic distance)
- "Straight lines" (geodesics) are circular arcs perpendicular to the boundary
- Camera navigation uses **Möbius transformations** to preserve angles

Key implementation details:
- **Pan**: Anchor-invariant—the point under your cursor stays under your cursor
- **Zoom**: `displayZoom` scales the visual disk without changing the hyperbolic view
- **Hit-test**: Respects hyperbolic distances, culls points outside the visible disk
- **Lasso**: Selection polygon is unprojected to data space for correct membership

## Project Structure

```
src/
├── core/
│   ├── math/
│   │   ├── euclidean.ts    # Euclidean projection, pan, zoom
│   │   └── poincare.ts     # Möbius transforms, hyperbolic math
│   ├── types.ts            # Renderer interface, data types
│   └── dataset.ts          # Synthetic data generation
├── impl_reference/
│   ├── euclidean_reference.ts   # Canvas2D Euclidean (ground truth)
│   └── hyperbolic_reference.ts  # Canvas2D Poincaré (ground truth)
├── impl_candidate/
│   ├── webgl_candidate.ts       # WebGL2 renderers (optimized)
│   └── spatial_index.ts         # Uniform grid for fast queries
├── benchmarks/
│   ├── accuracy.ts         # Reference vs candidate comparison
│   ├── browser.ts          # Performance benchmarks
│   └── run-*.ts            # CLI runners (Puppeteer)
└── ui/
    ├── app.ts              # Demo application
    └── lasso_simplify.ts   # Polygon smoothing (Chaikin + RDP)
```

## Quick Start

```bash
# Install dependencies
npm install

# Run the interactive demo
npm run dev
# Open http://localhost:5173

# Run accuracy tests (correctness gate)
npm run bench:accuracy

# Run performance benchmarks
npm run bench
```

## Using in HyperView (integration notes)

HyperView's frontend currently uses `regl-scatterplot` for its embeddings view. This repo's WebGL candidate renderers are designed to drop into that role, but there are a few integration-specific considerations.

### 1) Build the reusable library output

This repo now ships a small library entrypoint at `src/index.ts` and a build script that emits ESM + `.d.ts` to `dist-lib/`:

```bash
npm run build:lib
```

### 2) Install into HyperView's Next.js frontend

From `HyperView/frontend/` (the Next.js app), install this folder as a local dependency:

```bash
npm install ../viz_impl
```

Then you can import from the package name (`viz-lab`) rather than deep-importing internal paths.

### 3) Key integration differences vs `regl-scatterplot`

- **Hyperbolic backdrop:** `HyperbolicWebGLCandidate` renders the Poincaré disk boundary + grid **inside WebGL**.
  - Any DOM/SVG overlay that assumes an affine view transform will not stay aligned under Möbius transforms.
  - In HyperView, you should remove/disable the current SVG disk overlay when switching to the hyperbolic renderer.

- **Hyperbolic styling is configurable:** pass `backgroundColor`, `poincareDiskFillColor`, `poincareDiskBorderColor`, `poincareGridColor` in `InitOptions` to match your app theme.

- **Palette supports arbitrary label counts:** the candidate uses a small RGBA8 palette texture (no 16-uniform limit).

- **Large-N lasso selection can return geometry:** by default (`lassoSelectionMode: 'auto'`), `lassoSelect()` may return `{ kind: 'geometry' }` for large datasets to avoid enumerating huge index sets.
  - If HyperView needs concrete selected IDs, initialize with `lassoSelectionMode: 'indices'` (or set `lassoGeometryThreshold` higher).

### 4) Interaction wiring

The renderer contract (`src/core/types.ts`) is intentionally low-level (pan/zoom/hit/lasso), and the lab wires mouse/keyboard input in `src/ui/app.ts`.

For HyperView integration, you will want a small controller layer that:

- attaches pointer + wheel events to the canvas
- calls `renderer.pan(...)` / `renderer.zoom(...)`
- uses `renderer.hitTest(...)` for hover updates
- uses `renderer.lassoSelect(...)` for Shift+drag selection
- schedules `renderer.render()` at most once per animation frame

This keeps the renderer reusable across Next/React and avoids coupling it to the benchmark harness.

If you want a ready-made controller, the library exports `createInteractionController(canvas, renderer, opts)` which wires pointer + wheel events and schedules `renderer.render()` via rAF.

## Benchmark Commands

### Accuracy Tests
Compares reference (Canvas2D) vs candidate (WebGL) for correctness:

```bash
# Headed (see the browser)
npm run bench:accuracy

# Headless (CI)
npm run bench:accuracy -- --headless
```

### Performance Benchmarks
Measures render FPS, pan/hover FPS, hit-test time, lasso time:

```bash
# Default: WebGL candidate, all point counts
npm run bench

# Specific point counts
npm run bench -- --points=100000,1000000,5000000

# Single geometry
npm run bench -- --geometries=poincare

# Reference baseline (for comparison)
npm run bench -- --renderer=reference
```

**Important:** Use headed (non-headless) runs for performance numbers. Headless mode can skew GPU timing.

## Key Techniques

### Candidate Optimizations

| Technique | Purpose |
|-----------|---------|
| **WebGL2 point sprites** | GPU-accelerated rendering, 1 draw call for all points |
| **Uniform grid spatial index** | O(1) average hit-test queries |
| **Adaptive DPR** | Lower offscreen resolution during interaction |
| **Geometry-based selection** | Return polygon + `has()` predicate instead of enumerating millions of indices |
| **Selection overlay cap** | Render at most 50k highlighted points to avoid GPU buffer blowup |

### Lasso Selection Strategy

The WebGL candidate uses a uniform, geometry-first selection approach:

- Return the selection polygon in **data space** with optional AABB bounds.
- Provide `has(index)` for deterministic membership checks (used by the harness).
- Do not require enumerating huge index sets in the browser.

```typescript
interface SelectionResult {
  kind: 'indices' | 'geometry';
  indices?: Set<number>;           // Optional (not required for geometry-first workflows)
  geometry?: SelectionGeometry;    // Polygon coords (+ optional bounds)
  has(index: number): boolean;     // Always available
  computeTimeMs: number;
}
```

## Accuracy Tolerances

| Operation | Tolerance | Notes |
|-----------|-----------|-------|
| Projection | < 1e-6 px | Screen coordinate match |
| Unprojection | < 1e-6 | Data coordinate match |
| Pan/Zoom view state | < 1e-10 | Machine precision |
| Hit test | Exact | Same point index |
| Lasso select | Exact | Verified via `has()` |

## Development Workflow

```
1. Make changes to candidate renderer
         ↓
2. npm run bench:accuracy
   └─ Fix any correctness failures
         ↓
3. npm run bench
   └─ Check performance (before/after)
         ↓
4. Log results in research/candidate_optimization_log.md
         ↓
5. Repeat until 20M @ 60fps
```

## Demo Controls

| Action | Effect |
|--------|--------|
| **Drag** | Pan view |
| **Scroll** | Zoom in/out |
| **Shift+Cmd/Ctrl+Drag** | Lasso select |
| **Click** | Clear lasso selection |
| **Double-click** | Clear all selection |

## References

- [Poincaré disk model](https://en.wikipedia.org/wiki/Poincar%C3%A9_disk_model) — Wikipedia
- [Möbius transformations](https://en.wikipedia.org/wiki/M%C3%B6bius_transformation) — The math behind hyperbolic camera
- [Apple Embedding Atlas](https://machinelearning.apple.com/research/embedding-atlas) — Inspiration for large-scale embedding viz
- [Ramer-Douglas-Peucker](https://en.wikipedia.org/wiki/Ramer%E2%80%93Douglas%E2%80%93Peucker_algorithm) — Polygon simplification for lasso

## License

Private repository. All rights reserved.
