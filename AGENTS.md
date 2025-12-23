# viz-lab: Candidate Implementation Engineer Guide

This repo is a **correctness + performance lab** for an embedding scatterplot that supports both:

- **Euclidean** 2D scatter
- **Hyperbolic embeddings in the Poincaré disk** (geometry-aware camera + interactions)

This document is for working on the **optimized candidate renderer**.

If you are working on the **harness** (benchmarks, reference, runners, CI-ish glue), use **`CLAUDE.md`**. If you need to change harness semantics, flag your concerns to the user if it limits your performance potential. The user will pass on your concerns to the harness engineer.

For the full spec and rationale, see **`TASK.md`**.

---

## Where you should work (candidate code)

The candidate path already exists and is wired into the benchmark/accuracy harness:

- `src/impl_candidate/`

The reference implementations (ground truth) are:

- `src/impl_reference/euclidean_reference.ts`
- `src/impl_reference/hyperbolic_reference.ts`

Core math (shared by reference + candidate; **do not “approximate” this in the candidate**):

- `src/core/math/euclidean.ts`
- `src/core/math/poincare.ts`

---

## How the candidate is selected in the harness

The browser harness supports two renderer modes:

- `reference`: Canvas2D reference implementations
- `webgl`: WebGL2 candidate implementations

Selection happens in **`src/benchmarks/browser.ts`**:

- For performance benchmarks (`runBenchmarks`):
  - `renderer: 'webgl'` ⇒ `EuclideanWebGLCandidate` / `HyperbolicWebGLCandidate`
  - `renderer: 'reference'` ⇒ `EuclideanReference` / `HyperbolicReference`
- For accuracy tests (`runAccuracyBenchmarks`):
  - reference uses the visible `#canvas` (Canvas2D)
  - candidate uses a separate hidden/alternate `#candidateCanvas` (WebGL)

If you add a new candidate class/file, you typically only need to adjust the imports/constructor selection in `src/benchmarks/browser.ts`.

---

## Fast iteration loop (correctness first, then performance)

The harness provides:

1) **Correctness gates** (reference vs candidate accuracy)
2) **Performance benchmarks** (render + interaction workloads)

The **exact commands/flags and how to run them** are owned by the harness engineer and documented in **`CLAUDE.md`** (and the benchmark docs in `src/benchmarks/README.md`).

Operational expectations:

- Prefer running benchmarks via the **CLI runners** (reproducible, scriptable, fewer UI variables).
- For **performance** numbers, do **not** rely on **headless** runs as the source of truth (headless can change GPU/RAF timing and skew results). Use headed/interactive runs for final perf validation; headless is fine for quick smoke checks and automation.

As a candidate engineer, your iteration loop should be:

- run the accuracy suite after any semantics-affecting change
- only optimize after you’re passing correctness
- re-run benchmarks frequently to catch regressions

---

## Keep a running optimization log (recommended)

Keep a short, append-only log of what you tried and what happened. This saves time when you revisit the project or hand it off.

- Suggested location: `research/candidate_optimization_log.md`
- What to record: change summary, point counts/geometries tested, results (FPS / ms), correctness notes, and whether the technique was a win/loss.

---

## Product constraints to keep in mind

Even though the solution is validated in this harness, it will ship in a **web-based product**:

- It should work across major browsers and “good consumer hardware” (not just one dev GPU/driver).
- Avoid relying on quirks that only work in one browser/GPU stack.
- The harness runs on a representative machine to approximate real conditions, but you should still keep portability in mind.

Also: keep aesthetics in mind (pleasant point rendering, sensible colors, avoid obvious artifacts), but **prioritize performance** and interaction smoothness.

---

## What must remain exact (candidate invariants)

The candidate may change **how things are rendered**, but must preserve **what the system means**.

### Required correctness properties

- **Project/unproject** must match reference within tolerance.
- **Pan/zoom** must be **anchor-invariant** (cursor anchor stays fixed under the drag/zoom semantics defined by the geometry).
- **Hit-test** must match exactly (including deterministic tie-breaks).
- **Lasso selection** must match exactly.

Default tolerances enforced by the harness are documented in `src/benchmarks/README.md`.

### Important nuance: render quality vs interaction semantics

The existing WebGL candidate uses adaptive quality (LOD / lower offscreen DPR / squares vs circles) to keep interaction smooth at large $N$.

This is OK **only if it affects rendering output**, not semantics:

- hit-testing and lasso selection must remain exact (CPU-side) and match reference
- project/unproject + view state updates must remain exact (delegated to `src/core/math/*`)

---

## “If you touch X, check Y” (practical checklist)

- If you change camera/view math: run the **accuracy suite** immediately.
- If you change hit-testing or lasso: run the **accuracy suite** and spot-check edge cases (ties, near-boundary points).
- If you change GPU buffer upload strategy (subsampling, caps like `maxGpuUploadPoints`):
  - confirm semantics still use the full dataset on CPU
  - confirm selection/hover overlays don’t OOM for huge selections
- If you modify rendering policy knobs: run the **performance benchmarks** on a few point counts and both geometries.
