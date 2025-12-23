# viz-lab: Embedding Visualizer Performance Lab

## Current State

This is a testbed for building a high-performance embedding visualizer supporting both **Euclidean** and **Hyperbolic (Poincaré disk)** geometries.

### What Exists

1. **Reference Implementations** (`src/impl_reference/`)
   - `euclidean_reference.ts` - Naive Canvas2D Euclidean renderer
   - `hyperbolic_reference.ts` - Naive Canvas2D Poincaré disk renderer
   - These are **correct but slow** - they serve as ground truth

2. **Core Math** (`src/core/math/`)
   - `euclidean.ts` - Simple pan/zoom transforms
   - `poincare.ts` - Möbius transforms, hyperbolic distance, geodesics

3. **Benchmark Suite** (`src/benchmarks/`)
   - `node-bench.ts` - Pure math benchmarks (no DOM)
   - `browser.ts` - Canvas2D rendering benchmarks
   - `accuracy.ts` - Reference vs candidate comparison
   - See `src/benchmarks/README.md` for full documentation

4. **Demo App** (`index.html`, `src/main.ts`)
   - Interactive visualization with geometry toggle
   - Lasso selection, hover, pan/zoom

### Current Performance

| Points | Euclidean FPS | Hyperbolic FPS |
|--------|---------------|----------------|
| 10k    | ~57           | ~50            |
| 100k   | ~12           | ~3             |
| 500k   | ~2            | <1             |
| 1M     | ~0.7          | <0.5           |

**Bottlenecks:**
- O(n) render loop (drawing each point individually)
- O(n) hit test (checking every point on hover)
- O(n) lasso selection
- Hyperbolic: expensive Möbius transform per point per frame

## The Task: Create Optimized Candidate

**Goal: 20 million points at 60 FPS**

Create an optimized renderer in `src/impl_candidate/` that:
1. Passes all accuracy tests against the reference
2. Achieves 60 FPS with 20M points

### Suggested Optimization Strategies

1. **WebGL Rendering**
   - Batch all points into a single draw call
   - GPU-accelerated point sprites
   - Möbius transform in vertex shader

2. **Spatial Indexing**
   - Quadtree or R-tree for hit testing
   - Frustum culling for off-screen points

3. **Level of Detail**
   - Aggregate distant points
   - Progressive rendering

4. **Web Workers**
   - Offload selection to worker thread
   - Parallel point-in-polygon

### Iteration Workflow

```bash
# 1. Run math tests first (fast feedback)
npm run bench

# 2. Run browser accuracy tests
npm run bench:browser
# Click "Run Accuracy Tests"

# 3. Run performance benchmark
# Click "Run Performance Benchmark"
```

### Integration Point

Edit `src/benchmarks/browser.ts` line ~305:

```typescript
import { MyOptimizedRenderer } from '../impl_candidate/my_renderer.js';

const candidateRenderer: Renderer = geometry === 'euclidean'
  ? new EuclideanReference()
  : new MyOptimizedRenderer();  // <-- Your implementation
```

### Accuracy Requirements

| Operation | Tolerance |
|-----------|-----------|
| Projection | < 1e-6 pixels |
| Pan/Zoom state | < 1e-10 |
| Hit test | Exact match |
| Lasso select | Exact match |

## File Structure

```
viz_impl/
├── index.html              # Demo app entry
├── benchmark.html          # Benchmark UI
├── src/
│   ├── main.ts             # Demo app logic
│   ├── core/
│   │   ├── types.ts        # Renderer interface contract
│   │   ├── dataset.ts      # Test data generation
│   │   ├── math/
│   │   │   ├── euclidean.ts
│   │   │   └── poincare.ts # Möbius transforms
│   │   └── selection/
│   │       └── point_in_polygon.ts
│   ├── impl_reference/     # Ground truth (slow but correct)
│   │   ├── euclidean_reference.ts
│   │   └── hyperbolic_reference.ts
│   ├── impl_candidate/     # YOUR OPTIMIZED IMPLEMENTATIONS
│   │   └── (create files here)
│   └── benchmarks/
│       ├── README.md       # Detailed benchmark docs
│       ├── utils.ts
│       ├── accuracy.ts
│       ├── browser.ts
│       └── node-bench.ts
└── package.json
```

## Key Hyperbolic Math

The Poincaré disk represents hyperbolic space inside the unit disk (|z| < 1).

**Möbius Transform** (camera translation):
```
T_a(z) = (z - a) / (1 - conj(a) * z)
```

**Inverse**:
```
T_a^{-1}(w) = (w + a) / (1 + conj(a) * w)
```

**Anchor-invariant pan**: Solve for new camera `a'` such that the point under the cursor stays under the cursor after dragging.

See `src/core/math/poincare.ts` for implementation details.

## Commands

```bash
npm run dev          # Start dev server (localhost:5173)
npm run bench        # Run Node.js benchmarks
npm run bench:browser # Open browser benchmark page
npm run build        # Production build
```
