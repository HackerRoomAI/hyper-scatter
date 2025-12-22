/**
 * Poincare disk (hyperbolic) geometry utilities.
 *
 * The Poincare disk model represents hyperbolic space inside the unit disk.
 * Points are represented as complex numbers z with |z| < 1.
 *
 * Isometries (distance-preserving transformations) are Mobius transformations
 * of the form: f(z) = (z - a) / (1 - conj(a) * z) where |a| < 1
 *
 * This maps point 'a' to the origin, which is our "camera translation".
 *
 * References:
 * - https://math.libretexts.org/Bookshelves/Geometry/Geometry_with_an_Introduction_to_Cosmic_Topology_(Hitchman)/05:_Hyperbolic_Geometry/5.01:_The_Poincare_Disk_Model
 * - https://geoopt.readthedocs.io/en/latest/extended/stereographic.html
 */

import { HyperbolicViewState } from '../types.js';

/**
 * Create a default hyperbolic view state (centered at origin).
 */
export function createHyperbolicView(): HyperbolicViewState {
  return {
    type: 'poincare',
    ax: 0,
    ay: 0,
    displayZoom: 1,
  };
}

/**
 * Apply Mobius transformation: T_a(z) = (z - a) / (1 - conj(a) * z)
 * This is the hyperbolic isometry that translates 'a' to the origin.
 *
 * Mathematical derivation:
 * - Numerator: z - a (complex subtraction)
 * - Denominator: 1 - conj(a) * z where conj(a) = ax - i*ay
 */
export function mobiusTransform(
  zx: number,
  zy: number,
  ax: number,
  ay: number
): { x: number; y: number } {
  // Numerator: z - a
  const numX = zx - ax;
  const numY = zy - ay;

  // Denominator: 1 - conj(a) * z = 1 - (ax - i*ay)(zx + i*zy)
  // = 1 - (ax*zx + ay*zy + i*(ax*zy - ay*zx))
  const denomX = 1 - (ax * zx + ay * zy);
  const denomY = -(ax * zy - ay * zx);

  // Complex division: num / denom
  const denomNormSq = denomX * denomX + denomY * denomY;
  if (denomNormSq < 1e-12) {
    // Degenerate case, return clamped to boundary
    const norm = Math.sqrt(numX * numX + numY * numY);
    if (norm < 1e-12) return { x: 0, y: 0 };
    return { x: (numX / norm) * 0.999, y: (numY / norm) * 0.999 };
  }

  const resultX = (numX * denomX + numY * denomY) / denomNormSq;
  const resultY = (numY * denomX - numX * denomY) / denomNormSq;

  // Clamp to disk (numerical safety)
  const rSq = resultX * resultX + resultY * resultY;
  if (rSq >= 1) {
    const r = Math.sqrt(rSq);
    return { x: (resultX / r) * 0.999, y: (resultY / r) * 0.999 };
  }

  return { x: resultX, y: resultY };
}

/**
 * Inverse Mobius transformation.
 * If forward is T_a(z) = (z - a) / (1 - conj(a) * z)
 * Then inverse is T_a^{-1}(w) = (w + a) / (1 + conj(a) * w)
 */
export function inverseMobiusTransform(
  wx: number,
  wy: number,
  ax: number,
  ay: number
): { x: number; y: number } {
  // Numerator: w + a
  const numX = wx + ax;
  const numY = wy + ay;

  // Denominator: 1 + conj(a) * w = 1 + (ax - i*ay)(wx + i*wy)
  // = 1 + (ax*wx + ay*wy + i*(ax*wy - ay*wx))
  const denomX = 1 + (ax * wx + ay * wy);
  const denomY = ax * wy - ay * wx;

  // Complex division
  const denomNormSq = denomX * denomX + denomY * denomY;
  if (denomNormSq < 1e-12) {
    const norm = Math.sqrt(numX * numX + numY * numY);
    if (norm < 1e-12) return { x: 0, y: 0 };
    return { x: (numX / norm) * 0.999, y: (numY / norm) * 0.999 };
  }

  const resultX = (numX * denomX + numY * denomY) / denomNormSq;
  const resultY = (numY * denomX - numX * denomY) / denomNormSq;

  const rSq = resultX * resultX + resultY * resultY;
  if (rSq >= 1) {
    const r = Math.sqrt(rSq);
    return { x: (resultX / r) * 0.999, y: (resultY / r) * 0.999 };
  }

  return { x: resultX, y: resultY };
}

/**
 * Mobius addition (gyroaddition) in the Poincare ball.
 * Formula from geoopt for curvature k = -1:
 *
 * x ⊕ y = ((1 + 2⟨x,y⟩ + ‖y‖²)x + (1 - ‖x‖²)y) / (1 + 2⟨x,y⟩ + ‖x‖²‖y‖²)
 *
 * where ⟨x,y⟩ is the real inner product (dot product).
 */
export function mobiusAdd(
  ax: number,
  ay: number,
  bx: number,
  by: number
): { x: number; y: number } {
  const dotAB = ax * bx + ay * by; // ⟨a, b⟩
  const normASq = ax * ax + ay * ay; // ‖a‖²
  const normBSq = bx * bx + by * by; // ‖b‖²

  // Numerator coefficients
  const coeffA = 1 + 2 * dotAB + normBSq;
  const coeffB = 1 - normASq;

  // Denominator
  const denom = 1 + 2 * dotAB + normASq * normBSq;

  if (Math.abs(denom) < 1e-12) {
    return { x: 0, y: 0 };
  }

  const resultX = (coeffA * ax + coeffB * bx) / denom;
  const resultY = (coeffA * ay + coeffB * by) / denom;

  // Clamp to disk
  const rSq = resultX * resultX + resultY * resultY;
  if (rSq >= 1) {
    const r = Math.sqrt(rSq);
    return { x: (resultX / r) * 0.99, y: (resultY / r) * 0.99 };
  }

  return { x: resultX, y: resultY };
}

/**
 * Mobius negation: -x in the gyrogroup is just negation.
 */
export function mobiusNeg(x: number, y: number): { x: number; y: number } {
  return { x: -x, y: -y };
}

/**
 * Mobius subtraction: x ⊖ y = x ⊕ (-y)
 */
export function mobiusSub(
  ax: number,
  ay: number,
  bx: number,
  by: number
): { x: number; y: number } {
  return mobiusAdd(ax, ay, -bx, -by);
}

/**
 * Project a Poincare disk point to screen coordinates.
 */
export function projectPoincare(
  dataX: number,
  dataY: number,
  view: HyperbolicViewState,
  width: number,
  height: number
): { x: number; y: number } {
  // First apply the Mobius transformation (camera)
  const transformed = mobiusTransform(dataX, dataY, view.ax, view.ay);

  // Then apply display zoom and map to screen
  // The disk has radius 1, we map it to fit in the canvas
  const diskRadius = Math.min(width, height) * 0.45 * view.displayZoom;
  const x = width / 2 + transformed.x * diskRadius;
  const y = height / 2 - transformed.y * diskRadius; // flip Y

  return { x, y };
}

/**
 * Unproject screen coordinates to Poincare disk (data space).
 */
export function unprojectPoincare(
  screenX: number,
  screenY: number,
  view: HyperbolicViewState,
  width: number,
  height: number
): { x: number; y: number } {
  // Map screen to disk coordinates (after camera)
  const diskRadius = Math.min(width, height) * 0.45 * view.displayZoom;
  const diskX = (screenX - width / 2) / diskRadius;
  const diskY = -(screenY - height / 2) / diskRadius; // flip Y

  // Check if point is outside disk
  const rSq = diskX * diskX + diskY * diskY;
  if (rSq >= 1) {
    // Clamp to disk boundary
    const r = Math.sqrt(rSq);
    const clampedX = (diskX / r) * 0.999;
    const clampedY = (diskY / r) * 0.999;
    return inverseMobiusTransform(clampedX, clampedY, view.ax, view.ay);
  }

  // Apply inverse Mobius to get data coordinates
  return inverseMobiusTransform(diskX, diskY, view.ax, view.ay);
}

/**
 * Solve for new camera position a' such that T_{a'}(p) = d2
 *
 * Given: data point p, target display position d2
 * Find: camera a' such that (p - a') / (1 - conj(a') * p) = d2
 *
 * This is solved as a linear system in the real and imaginary parts of a'.
 *
 * The system is:
 *   (1 - A) * x - B * y = px - d2x
 *   B * x - (1 + A) * y = d2y - py
 *
 * where A = d2x*px - d2y*py, B = d2x*py + d2y*px
 * and the determinant is A² + B² - 1 = |d2|²|p|² - 1
 */
function solveForCamera(
  px: number,
  py: number,
  d2x: number,
  d2y: number
): { x: number; y: number } {
  const A = d2x * px - d2y * py;
  const B = d2x * py + d2y * px;

  // Determinant = |d2|² * |p|² - 1
  // For points inside disk, this is always negative
  const det = A * A + B * B - 1;

  if (Math.abs(det) < 1e-10) {
    // Degenerate case: either p or d2 is at origin, or on boundary
    // Fall back to simple approximation
    return { x: -d2x, y: -d2y };
  }

  const rhsX = px - d2x;
  const rhsY = d2y - py;

  // Cramer's rule
  const x = (-(1 + A) * rhsX + B * rhsY) / det;
  const y = ((1 - A) * rhsY - B * rhsX) / det;

  // Clamp to ensure |a'| < 1
  const rSq = x * x + y * y;
  if (rSq >= 1) {
    const r = Math.sqrt(rSq);
    return { x: (x / r) * 0.99, y: (y / r) * 0.99 };
  }

  return { x, y };
}

/**
 * Apply pan to hyperbolic view (anchor-invariant).
 *
 * The point under the cursor at drag start should stay under the cursor
 * throughout the drag. This is the correct "natural" drag behavior.
 *
 * Algorithm:
 * 1. Find the data point p under the start screen position
 * 2. Get the target disk position d2 from end screen position
 * 3. Solve for new camera a' such that T_{a'}(p) = d2
 */
export function panPoincare(
  view: HyperbolicViewState,
  startScreenX: number,
  startScreenY: number,
  endScreenX: number,
  endScreenY: number,
  width: number,
  height: number
): HyperbolicViewState {
  const diskRadius = Math.min(width, height) * 0.45 * view.displayZoom;

  // Convert screen positions to disk coordinates (display space, after camera)
  const d1x = (startScreenX - width / 2) / diskRadius;
  const d1y = -(startScreenY - height / 2) / diskRadius;
  const d2x = (endScreenX - width / 2) / diskRadius;
  const d2y = -(endScreenY - height / 2) / diskRadius;

  // Clamp to disk with margin
  const clampToDisk = (x: number, y: number, maxR: number = 0.95) => {
    const rSq = x * x + y * y;
    if (rSq > maxR * maxR) {
      const r = Math.sqrt(rSq);
      return { x: (x / r) * maxR, y: (y / r) * maxR };
    }
    return { x, y };
  };

  const d1 = clampToDisk(d1x, d1y);
  const d2 = clampToDisk(d2x, d2y);

  // Get the data point currently displayed at d1
  // p = T_a^{-1}(d1)
  const p = inverseMobiusTransform(d1.x, d1.y, view.ax, view.ay);

  // Solve for new camera a' such that T_{a'}(p) = d2
  const newA = solveForCamera(p.x, p.y, d2.x, d2.y);

  return {
    ...view,
    ax: newA.x,
    ay: newA.y,
  };
}

/**
 * Apply zoom to hyperbolic view (anchor-invariant).
 *
 * Display zoom scales the visual representation while keeping the
 * data point under the cursor stationary.
 */
export function zoomPoincare(
  view: HyperbolicViewState,
  anchorScreenX: number,
  anchorScreenY: number,
  delta: number,
  width: number,
  height: number
): HyperbolicViewState {
  // Calculate new display zoom
  const zoomFactor = Math.pow(1.1, delta);
  const newDisplayZoom = Math.max(0.5, Math.min(10, view.displayZoom * zoomFactor));

  // Get the data point under the anchor
  const dataPoint = unprojectPoincare(anchorScreenX, anchorScreenY, view, width, height);

  // Calculate where this data point would appear with new zoom (but same camera)
  const diskRadiusNew = Math.min(width, height) * 0.45 * newDisplayZoom;

  // The display position of dataPoint after camera transform
  const transformed = mobiusTransform(dataPoint.x, dataPoint.y, view.ax, view.ay);

  // Screen position with new zoom (if we don't adjust camera)
  const newScreenX = width / 2 + transformed.x * diskRadiusNew;
  const newScreenY = height / 2 - transformed.y * diskRadiusNew;

  // If the point moved significantly, adjust camera to compensate
  const dx = newScreenX - anchorScreenX;
  const dy = newScreenY - anchorScreenY;

  if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
    // Pan to bring the anchor point back under the cursor
    return panPoincare(
      { ...view, displayZoom: newDisplayZoom },
      newScreenX,
      newScreenY,
      anchorScreenX,
      anchorScreenY,
      width,
      height
    );
  }

  return {
    ...view,
    displayZoom: newDisplayZoom,
  };
}

/**
 * Hyperbolic distance between two points in the Poincare disk.
 * d(z1, z2) = 2 * arctanh(|z1 - z2| / |1 - conj(z1) * z2|)
 */
export function hyperbolicDistance(
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const diffX = x1 - x2;
  const diffY = y1 - y2;
  const diffNorm = Math.sqrt(diffX * diffX + diffY * diffY);

  // 1 - conj(z1) * z2
  const denomX = 1 - (x1 * x2 + y1 * y2);
  const denomY = -(x1 * y2 - y1 * x2);
  const denomNorm = Math.sqrt(denomX * denomX + denomY * denomY);

  if (denomNorm < 1e-12) return Infinity;

  // Clamp ratio to avoid atanh(1) = Infinity due to floating-point errors
  const ratio = Math.min(diffNorm / denomNorm, 1 - 1e-10);

  return 2 * Math.atanh(ratio);
}

/**
 * Geodesic interpolation between two points.
 * gamma(t) = x ⊕ (t ⊗ ((-x) ⊕ y))
 *
 * For simplicity, we use a linear approximation in disk space
 * which is accurate for small distances.
 */
export function geodesicInterpolate(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  t: number
): { x: number; y: number } {
  // Transform so x1 is at origin
  const transformed = mobiusTransform(x2, y2, x1, y1);

  // Scale by t (this is exact for geodesics through origin)
  const scaledNorm = Math.sqrt(transformed.x * transformed.x + transformed.y * transformed.y);
  if (scaledNorm < 1e-12) {
    return { x: x1, y: y1 };
  }

  // Clamp to avoid atanh(1) = Infinity near boundary
  const clampedNorm = Math.min(scaledNorm, 1 - 1e-10);

  // Use arctanh/tanh for proper geodesic scaling
  const targetNorm = Math.tanh(t * Math.atanh(clampedNorm));
  const scaled = {
    x: (transformed.x / scaledNorm) * targetNorm,
    y: (transformed.y / scaledNorm) * targetNorm,
  };

  // Transform back
  return inverseMobiusTransform(scaled.x, scaled.y, x1, y1);
}
