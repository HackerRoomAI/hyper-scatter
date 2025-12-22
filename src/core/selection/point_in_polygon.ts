/**
 * Point-in-polygon test using ray casting algorithm.
 * This is the naive, accurate implementation for reference.
 */

/**
 * Test if a point is inside a polygon using ray casting.
 * Polygon is given as interleaved x,y coordinates.
 *
 * Boundary rule: points exactly on the edge are considered INSIDE.
 */
export function pointInPolygon(
  px: number,
  py: number,
  polygon: Float32Array
): boolean {
  const n = polygon.length / 2;
  if (n < 3) return false;

  let inside = false;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i * 2];
    const yi = polygon[i * 2 + 1];
    const xj = polygon[j * 2];
    const yj = polygon[j * 2 + 1];

    // Check if point is on edge (within tolerance)
    if (isPointOnSegment(px, py, xi, yi, xj, yj, 1e-9)) {
      return true; // Boundary counts as inside
    }

    // Ray casting
    if ((yi > py) !== (yj > py)) {
      const xIntersect = ((xj - xi) * (py - yi)) / (yj - yi) + xi;
      if (px < xIntersect) {
        inside = !inside;
      }
    }
  }

  return inside;
}

/**
 * Check if a point lies on a line segment (within tolerance).
 */
function isPointOnSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  tolerance: number
): boolean {
  // Check if point is within bounding box
  const minX = Math.min(x1, x2) - tolerance;
  const maxX = Math.max(x1, x2) + tolerance;
  const minY = Math.min(y1, y2) - tolerance;
  const maxY = Math.max(y1, y2) + tolerance;

  if (px < minX || px > maxX || py < minY || py > maxY) {
    return false;
  }

  // Calculate distance from point to line
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;

  if (lengthSq < tolerance * tolerance) {
    // Degenerate segment (point)
    const dist = Math.sqrt((px - x1) * (px - x1) + (py - y1) * (py - y1));
    return dist <= tolerance;
  }

  // Project point onto line
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSq));
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;

  const dist = Math.sqrt((px - projX) * (px - projX) + (py - projY) * (py - projY));
  return dist <= tolerance;
}

/**
 * Brute-force lasso selection: test all points against polygon.
 * Returns indices of points inside the polygon.
 */
export function lassoSelectBruteForce(
  positions: Float32Array,
  polygon: Float32Array
): Set<number> {
  const result = new Set<number>();
  const n = positions.length / 2;

  for (let i = 0; i < n; i++) {
    const x = positions[i * 2];
    const y = positions[i * 2 + 1];
    if (pointInPolygon(x, y, polygon)) {
      result.add(i);
    }
  }

  return result;
}
