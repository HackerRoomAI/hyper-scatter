/**
 * Lasso polygon simplification utilities.
 *
 * These are UI-level helpers (not benchmark-critical math) and are intended to
 * match the "feel" of Embedding Atlas' lasso:
 * - sample points while dragging
 * - smooth (Chaikin)
 * - simplify until under vertex budget
 */

function boundingRectXY(points: ArrayLike<number>): { xMin: number; yMin: number; xMax: number; yMax: number } {
  let xMin = Infinity;
  let yMin = Infinity;
  let xMax = -Infinity;
  let yMax = -Infinity;
  for (let i = 0; i < points.length; i += 2) {
    const x = points[i];
    const y = points[i + 1];
    if (x < xMin) xMin = x;
    if (x > xMax) xMax = x;
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
  }
  if (!Number.isFinite(xMin) || !Number.isFinite(yMin)) {
    return { xMin: 0, yMin: 0, xMax: 0, yMax: 0 };
  }
  return { xMin, yMin, xMax, yMax };
}

function chaikinClosedXY(points: ArrayLike<number>, iterations: number): number[] {
  // Chaikin smoothing on a closed polygon.
  let pts = Array.from(points);
  let n = Math.floor(pts.length / 2);
  if (n < 3) return pts;

  for (let it = 0; it < iterations; it++) {
    n = Math.floor(pts.length / 2);
    if (n < 3) break;
    const out: number[] = new Array(n * 4);
    let w = 0;
    for (let i = 0; i < n; i++) {
      const i0 = i;
      const i1 = (i + 1) % n;
      const x0 = pts[i0 * 2];
      const y0 = pts[i0 * 2 + 1];
      const x1 = pts[i1 * 2];
      const y1 = pts[i1 * 2 + 1];

      // Q = 0.75*p0 + 0.25*p1
      out[w++] = 0.75 * x0 + 0.25 * x1;
      out[w++] = 0.75 * y0 + 0.25 * y1;
      // R = 0.25*p0 + 0.75*p1
      out[w++] = 0.25 * x0 + 0.75 * x1;
      out[w++] = 0.25 * y0 + 0.75 * y1;
    }
    pts = out;
  }

  return pts;
}

/**
 * Simplify a closed polygon represented as an interleaved XY list.
 *
 * Returns a new `Float32Array` of interleaved XY coordinates.
 */
export function simplifyPolygonData(points: ArrayLike<number>, maxVerts: number): Float32Array {
  // Embedding Atlas strategy (ported conceptually):
  // 1) Chaikin smoothing on the closed polygon.
  // 2) Simplify with a tolerance derived from bounding box; increase until within budget.
  const n0 = Math.floor(points.length / 2);
  if (n0 <= maxVerts) return new Float32Array(points as any);

  // Safety: avoid pathological blow-ups if the user drags for a long time.
  // If we have too many points, pre-subsample before smoothing.
  const MAX_RAW = 2048;
  let base: ArrayLike<number> = points;
  if (n0 > MAX_RAW) {
    const out = new Float32Array(MAX_RAW * 2);
    for (let i = 0; i < MAX_RAW; i++) {
      const src = Math.floor((i * n0) / MAX_RAW);
      out[i * 2] = points[src * 2];
      out[i * 2 + 1] = points[src * 2 + 1];
    }
    base = out;
  }

  const smoothed = chaikinClosedXY(base, 5);
  const rect = boundingRectXY(smoothed);
  const span = Math.max(rect.xMax - rect.xMin, rect.yMax - rect.yMin);

  const distSqToSegment = (px: number, py: number, ax: number, ay: number, bx: number, by: number): number => {
    const abx = bx - ax;
    const aby = by - ay;
    const apx = px - ax;
    const apy = py - ay;
    const abLenSq = abx * abx + aby * aby;
    let t = 0;
    if (abLenSq > 1e-12) {
      t = (apx * abx + apy * aby) / abLenSq;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
    }
    const qx = ax + t * abx;
    const qy = ay + t * aby;
    const dx = px - qx;
    const dy = py - qy;
    return dx * dx + dy * dy;
  };

  const rdp = (eps: number): number[] => {
    const m = Math.floor(smoothed.length / 2);
    if (m <= 2) return smoothed.slice();

    const epsSq = eps * eps;
    const keep = new Uint8Array(m);
    keep[0] = 1;
    keep[m - 1] = 1;

    const stack: number[] = [0, m - 1];
    while (stack.length > 0) {
      const end = stack.pop()!;
      const start = stack.pop()!;

      const ax = smoothed[start * 2];
      const ay = smoothed[start * 2 + 1];
      const bx = smoothed[end * 2];
      const by = smoothed[end * 2 + 1];

      let maxD = -1;
      let maxI = -1;
      for (let i = start + 1; i < end; i++) {
        const px = smoothed[i * 2];
        const py = smoothed[i * 2 + 1];
        const d = distSqToSegment(px, py, ax, ay, bx, by);
        if (d > maxD) {
          maxD = d;
          maxI = i;
        }
      }

      if (maxD > epsSq && maxI >= 0) {
        keep[maxI] = 1;
        stack.push(start, maxI);
        stack.push(maxI, end);
      }
    }

    const out: number[] = [];
    for (let i = 0; i < m; i++) {
      if (!keep[i]) continue;
      out.push(smoothed[i * 2], smoothed[i * 2 + 1]);
    }
    return out;
  };

  // Match Embedding Atlas: start with tolerance ~= bbox/100, then increase slowly.
  let tol = Math.max(1e-12, span / 100);
  let simplified = rdp(tol);
  let it = 0;
  while (Math.floor(simplified.length / 2) > maxVerts && it < 20) {
    tol *= 1.1;
    simplified = rdp(tol);
    it++;
  }

  // Final safety: if still too large, fall back to uniform subsampling.
  const n = Math.floor(simplified.length / 2);
  if (n > maxVerts) {
    const out = new Float32Array(maxVerts * 2);
    for (let i = 0; i < maxVerts; i++) {
      const src = Math.floor((i * n) / maxVerts);
      out[i * 2] = simplified[src * 2];
      out[i * 2 + 1] = simplified[src * 2 + 1];
    }
    return out;
  }

  return new Float32Array(simplified);
}
