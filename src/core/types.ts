/**
 * Core types and contracts for the viz-lab.
 * Both reference and candidate implementations must satisfy these interfaces.
 */

// ============================================================================
// Data Types
// ============================================================================

export interface Dataset {
  /** Number of points */
  n: number;
  /** Interleaved x,y coordinates: [x0, y0, x1, y1, ...] length = 2*n */
  positions: Float32Array;
  /** Label for each point (for coloring) */
  labels: Uint16Array;
  /** Geometry mode */
  geometry: GeometryMode;
}

export type GeometryMode = 'euclidean' | 'poincare';

// ============================================================================
// View State
// ============================================================================

/** Euclidean view state: simple pan + zoom */
export interface EuclideanViewState {
  type: 'euclidean';
  /** Center of view in data coordinates */
  centerX: number;
  centerY: number;
  /** Zoom level (1 = no zoom, >1 = zoomed in) */
  zoom: number;
}

/**
 * Hyperbolic view state using Mobius transformation.
 * The isometry is represented as translation by a point in the disk.
 * Camera transform: z -> (z - a) / (1 - conj(a) * z) where a = (ax, ay)
 */
export interface HyperbolicViewState {
  type: 'poincare';
  /** Translation point x-coordinate (in Poincare disk, |a| < 1) */
  ax: number;
  /** Translation point y-coordinate */
  ay: number;
  /** Display zoom scalar (purely visual, applied after Mobius) */
  displayZoom: number;
}

export type ViewState = EuclideanViewState | HyperbolicViewState;

// ============================================================================
// Interaction Types
// ============================================================================

export interface Modifiers {
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
  meta: boolean;
}

export interface HitResult {
  index: number;
  screenX: number;
  screenY: number;
  distance: number;
}

export interface SelectionResult {
  indices: Set<number>;
  computeTimeMs: number;
}

export type InteractionMode = 'pan' | 'lasso';

// ============================================================================
// Renderer Contract
// ============================================================================

export interface InitOptions {
  width: number;
  height: number;
  devicePixelRatio?: number;
  backgroundColor?: string;
  pointRadius?: number;
  colors?: string[];
}

export interface Renderer {
  /** Initialize the renderer with a canvas */
  init(canvas: HTMLCanvasElement, opts: InitOptions): void;

  /** Set the dataset to render */
  setDataset(dataset: Dataset): void;

  /** Set the current view state */
  setView(view: ViewState): void;

  /** Get the current view state */
  getView(): ViewState;

  /** Render the current frame */
  render(): void;

  /** Handle canvas resize */
  resize(width: number, height: number): void;

  /** Set selected point indices */
  setSelection(indices: Set<number>): void;

  /** Get current selection */
  getSelection(): Set<number>;

  /** Set hovered point index (-1 for none) */
  setHovered(index: number): void;

  /** Clean up resources */
  destroy(): void;

  // Interaction methods

  /** Pan the view (in screen pixels) */
  pan(deltaX: number, deltaY: number, modifiers: Modifiers): void;

  /** Zoom at anchor point (wheel delta, positive = zoom in) */
  zoom(anchorX: number, anchorY: number, delta: number, modifiers: Modifiers): void;

  /** Hit test at screen coordinates */
  hitTest(screenX: number, screenY: number): HitResult | null;

  /** Lasso selection with screen-space polyline */
  lassoSelect(polyline: Float32Array): SelectionResult;

  /** Project a data point to screen coordinates */
  projectToScreen(dataX: number, dataY: number): { x: number; y: number };

  /** Unproject screen coordinates to data space */
  unprojectFromScreen(screenX: number, screenY: number): { x: number; y: number };
}

// ============================================================================
// Default Colors (categorical palette)
// ============================================================================

export const DEFAULT_COLORS = [
  '#4e79a7', // blue
  '#f28e2c', // orange
  '#e15759', // red
  '#76b7b2', // teal
  '#59a14f', // green
  '#edc949', // yellow
  '#af7aa1', // purple
  '#ff9da7', // pink
  '#9c755f', // brown
  '#bab0ab', // gray
];

export const SELECTION_COLOR = '#ff0000';
export const HOVER_COLOR = '#ffffff';
