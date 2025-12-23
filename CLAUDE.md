# viz-lab: Engineer Brief (Harness + Reference)

You own the **harness** (correctness + performance) and the **reference implementations** (ground truth).

Harness code will evolve; the **goals and invariants** must not.

For the full, longer spec and rationale, you can reference `TASK.md`.

If you are implementing an optimized **candidate** renderer, the most relevant starting points are `src/benchmarks/README.md` and `src/impl_candidate/`.

Benchmarks are primarily run via the CLI (often headless/automated), not manually in the browser UI.

The harness must include (and you must keep up to date) simple, reliable instructions for engineers to run accuracy tests and benchmarks.

---

## Goal

Build a lab that can make two objective statements for every supported geometry:

1) **Correctness:** candidate behavior matches the reference (within specified tolerances).
2) **Performance:** candidate is faster under realistic workloads (render + interaction), and regressions are detectable.

The lab must be **geometry-extensible**. Euclidean and Poincaré are initial examples, not the final list.

---

## What “correct” means (invariants)

These are the non-negotiables the harness must enforce.

- **Determinism:** same dataset seed + same view + same interaction sequence ⇒ same results.
- **Explicit semantics per geometry:** no “close enough Euclidean” fallbacks for non-Euclidean geometries.
- **Anchor-invariant interaction:** pan/zoom must preserve the point under the cursor (when the geometry’s model defines such an invariant).

---

## What “fast” means

Measure and report performance in a way that reflects real usage:

- steady-state render
- panning
- hovering/picking
- lasso/selection

Benchmarks must be reproducible and comparable over time.

**Important harness principle:** design the harness so it does **not** limit the performance potential of the candidate implementation or force it into a particular technical direction (e.g. requiring a specific rendering pipeline, mandatory GPU readbacks, fixed buffer layouts, or other constraints that bias optimization choices). The harness should specify **semantics and measurements**, not dictate *how* the candidate achieves them.

---

## Outputs the harness must produce

- **Actionable failures:** what diverged (operation), by how much, and how to reproduce.
- **Machine-readable summaries:** pass/fail + key metrics suitable for CI/regression tracking.

The test suite should continuously evolve to cover **accuracy and performance** and be robust against “loopholes” (i.e., implementations that game benchmarks or satisfy tests while violating intended semantics).


