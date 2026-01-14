import type { Dataset, GeometryMode } from './core/types.js';

export type {
  Dataset,
  GeometryMode,
  Renderer,
  InitOptions,
  ViewState,
  EuclideanViewState,
  HyperbolicViewState,
  Modifiers,
  HitResult,
  Bounds2D,
  SelectionGeometry,
  SelectionResult,
} from './core/types.js';

export {
  DEFAULT_COLORS,
  SELECTION_COLOR,
  HOVER_COLOR,
} from './core/types.js';

export {
  EuclideanWebGLCandidate,
  HyperbolicWebGLCandidate,
} from './impl_candidate/webgl_candidate.js';

export {
  createInteractionController,
  type InteractionController,
  type InteractionControllerOptions,
} from './controller/interaction_controller.js';

export {
  boundsOfPolygon,
  pointInPolygon,
} from './core/selection/point_in_polygon.js';

export function createDataset(
  geometry: GeometryMode,
  positions: Float32Array,
  labels?: Uint16Array,
): Dataset {
  if (positions.length % 2 !== 0) {
    throw new Error(`positions length must be even (got ${positions.length})`);
  }

  const n = positions.length / 2;
  const labelArray = labels ?? new Uint16Array(n);

  if (labelArray.length !== n) {
    throw new Error(`labels length must equal number of points (${n}), got ${labelArray.length}`);
  }

  return {
    n,
    positions,
    labels: labelArray,
    geometry,
  };
}

export function packPositions(points: ReadonlyArray<readonly [number, number]>): Float32Array {
  const out = new Float32Array(points.length * 2);
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    out[i * 2] = p[0];
    out[i * 2 + 1] = p[1];
  }
  return out;
}

export function packPositionsXY(x: ArrayLike<number>, y: ArrayLike<number>): Float32Array {
  if (x.length !== y.length) {
    throw new Error(`x/y length mismatch: ${x.length} vs ${y.length}`);
  }

  const out = new Float32Array(x.length * 2);
  for (let i = 0; i < x.length; i++) {
    out[i * 2] = x[i];
    out[i * 2 + 1] = y[i];
  }
  return out;
}

export function packUint16Labels(categories: ArrayLike<number>): Uint16Array {
  const out = new Uint16Array(categories.length);
  for (let i = 0; i < categories.length; i++) {
    const v = categories[i];
    if (!Number.isFinite(v) || v < 0 || v > 0xffff) {
      throw new Error(`label index out of range at ${i}: ${v}`);
    }
    out[i] = v;
  }
  return out;
}
