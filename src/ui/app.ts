/**
 * Demo application for the viz-lab.
 * Provides interactive UI for testing reference implementations.
 */

import { Dataset, GeometryMode, Renderer, InteractionMode, Modifiers, SelectionResult } from '../core/types.js';
import { generateDataset, type DatasetDistribution } from '../core/dataset.js';
import { EuclideanReference } from '../impl_reference/euclidean_reference.js';
import { HyperbolicReference } from '../impl_reference/hyperbolic_reference.js';
import { EuclideanWebGLCandidate, HyperbolicWebGLCandidate } from '../impl_candidate/webgl_candidate.js';
import { simplifyPolygonData } from '../core/lasso_simplify.js';

type RendererType = 'webgl' | 'reference';

// DOM elements
let canvas = document.getElementById('canvas') as HTMLCanvasElement;
const overlayCanvas = document.getElementById('overlayCanvas') as HTMLCanvasElement;
const canvasBody = document.getElementById('canvasBody') as HTMLDivElement;
const canvasHeader = document.getElementById('canvasHeader') as HTMLSpanElement;
const rendererInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="renderer"]'));
const geometryInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="geometry"]'));
const numPointsInput = document.getElementById('numPoints') as HTMLInputElement;
const numPointsLabel = document.getElementById('numPointsLabel') as HTMLSpanElement;
const datasetModeSelect = document.getElementById('datasetMode') as HTMLSelectElement;
const labelCountInput = document.getElementById('labelCount') as HTMLInputElement;
const labelCountLabel = document.getElementById('labelCountLabel') as HTMLSpanElement | null;
const seedInput = document.getElementById('seed') as HTMLInputElement;
const modeIndicator = document.getElementById('modeIndicator') as HTMLSpanElement;

// Stats elements
const statPoints = document.getElementById('statPoints') as HTMLSpanElement;
const statSelected = document.getElementById('statSelected') as HTMLSpanElement;
const statHovered = document.getElementById('statHovered') as HTMLSpanElement;
const statFrameTime = document.getElementById('statFrameTime') as HTMLSpanElement;
const statLassoTime = document.getElementById('statLassoTime') as HTMLSpanElement;

// State
let renderer: Renderer | null = null;
let dataset: Dataset | null = null;
let lastDatasetKey = '';
let currentGeometry: GeometryMode = 'euclidean';
let currentRendererType: RendererType = 'webgl';
let mode: InteractionMode = 'pan';

const POINT_PRESETS = [
  1_000,
  10_000,
  50_000,
  100_000,
  250_000,
  500_000,
  1_000_000,
  2_000_000,
  5_000_000,
  10_000_000,
  20_000_000,
];

// Interaction state
let isDragging = false;
let isLassoing = false;
let lastMouseX = 0;
let lastMouseY = 0;

// Lasso UX notes (Embedding Atlas style):
// - Gesture: Shift + Meta/Ctrl drag (momentary) starts lasso.
// - Lasso vertices are simplified continuously while dragging.
// - The lasso overlay persists after mouse-up until explicitly cleared.
// - The persistent overlay is stored in DATA SPACE so it tracks pan/zoom.
const LASSO_MAX_VERTS_INTERACTION = 24;
const LASSO_MAX_VERTS_FINAL = 24;
const LASSO_MIN_SAMPLE_DIST_PX = 2.0;

// Raw sampled lasso points in DATA SPACE (interleaved x,y).
// We sample in data space (Embedding Atlas style) so simplification is
// view-invariant and avoids screen-space artifacts.
let lassoRawDataPoints: number[] = [];

// Current simplified lasso polygon in DATA SPACE (interleaved x,y).
let lassoActiveDataPolygon: Float32Array | null = null;

// For sampling thresholding (screen space).
let lassoLastScreenX = 0;
let lassoLastScreenY = 0;
let lassoDirty = false;

// Persisted range selection (data-space polygon: interleaved x,y).
let rangeSelectionDataPolygon: Float32Array | null = null;

function projectDataPolygonToScreen(polyData: Float32Array): Float32Array {
  if (!renderer) return polyData;
  const n = polyData.length / 2;
  const out = new Float32Array(polyData.length);
  for (let i = 0; i < n; i++) {
    const x = polyData[i * 2];
    const y = polyData[i * 2 + 1];
    const s = renderer.projectToScreen(x, y);
    out[i * 2] = s.x;
    out[i * 2 + 1] = s.y;
  }
  return out;
}

// Cancel token for async selection materialization.
let selectionJobId = 0;

async function countSelectionAsync(
  jobId: number,
  result: SelectionResult,
): Promise<void> {
  if (!renderer) return;

  const total = await renderer.countSelection(result, {
    shouldCancel: () => jobId !== selectionJobId,
    onProgress: (selectedCount) => {
      if (jobId !== selectionJobId) return;
      statSelected.textContent = `${selectedCount.toLocaleString()} (computing…)`;
    },
    yieldEveryMs: 8,
  });

  if (jobId !== selectionJobId) return;
  statSelected.textContent = total.toLocaleString();
}

// Frame scheduling + throttling
let rafPending = false;
let needsRender = false;
let lastRafTs = 0;

// Coalesced interaction work (apply at most once per frame)
let pendingPanDx = 0;
let pendingPanDy = 0;
let pendingModifiers: Modifiers = { shift: false, ctrl: false, alt: false, meta: false };

let pendingHoverX = 0;
let pendingHoverY = 0;
let hoverDirty = false;

// Performance tracking
let frameCount = 0;
const frameTimes: number[] = [];
const frameIntervals: number[] = [];

// Debug/automation hook (used by demo interaction benchmark)
declare global {
  interface Window {
    __vizDemo?: {
      getRenderer: () => Renderer | null;
      getView: () => any;
      getCanvasSize: () => { cssWidth: number; cssHeight: number; bufferWidth: number; bufferHeight: number };
    };
  }
}

window.__vizDemo = {
  getRenderer: () => renderer,
  getView: () => renderer ? renderer.getView() : null,
  getCanvasSize: () => ({
    cssWidth: canvas.clientWidth,
    cssHeight: canvas.clientHeight,
    bufferWidth: canvas.width,
    bufferHeight: canvas.height,
  }),
};

/**
 * Replace the canvas element to reset context.
 * A canvas can only have one context type (WebGL or 2D), so we need a fresh canvas when switching.
 */
function replaceCanvas(): HTMLCanvasElement {
  const newCanvas = document.createElement('canvas');
  newCanvas.id = 'canvas';
  canvas.replaceWith(newCanvas);
  canvas = newCanvas;

  // Re-attach event listeners to new canvas
  canvas.addEventListener('mousedown', handleMouseDown);
  canvas.addEventListener('mousemove', handleMouseMove);
  canvas.addEventListener('mouseup', handleMouseUp);
  canvas.addEventListener('mouseleave', handleMouseUp);
  canvas.addEventListener('wheel', handleWheel, { passive: false });
  canvas.addEventListener('dblclick', handleDoubleClick);

  return newCanvas;
}

/**
 * Read theme-aware visualization colors from CSS custom properties.
 */
function getVizThemeColors(): {
  backgroundColor: string;
  diskFillColor: string;
  diskBorderColor: string;
  gridColor: string;
} {
  const styles = getComputedStyle(document.documentElement);
  const pick = (name: string, fallback: string) => {
    const value = styles.getPropertyValue(name).trim();
    return value || fallback;
  };

  return {
    backgroundColor: pick('--viz-bg', '#13171f'),
    diskFillColor: pick('--viz-disk', '#1b2230'),
    diskBorderColor: pick('--viz-border', '#6b7280'),
    gridColor: pick('--viz-grid', '#2b334266'),
  };
}

/**
 * Initialize the renderer based on geometry and renderer type.
 */
function initRenderer(geometry: GeometryMode, rendererType: RendererType): void {
  if (renderer) {
    renderer.destroy();
  }

  // Replace canvas when switching between WebGL and 2D contexts
  // A canvas can only have one context type
  const needsNewCanvas = currentRendererType !== rendererType ||
    (rendererType === 'webgl' && !canvas.getContext('webgl2')) ||
    (rendererType === 'reference' && !canvas.getContext('2d'));

  if (needsNewCanvas) {
    replaceCanvas();
  }

  const rect = canvasBody.getBoundingClientRect();
  const width = Math.floor(rect.width);
  const height = Math.floor(rect.height);

  // Keep overlay canvas in sync regardless of renderer type.
  resizeOverlay(width, height);

  if (rendererType === 'webgl') {
    if (geometry === 'euclidean') {
      renderer = new EuclideanWebGLCandidate();
    } else {
      renderer = new HyperbolicWebGLCandidate();
    }
    canvasHeader.textContent = 'WebGL';
  } else {
    if (geometry === 'euclidean') {
      renderer = new EuclideanReference();
    } else {
      renderer = new HyperbolicReference();
    }
    canvasHeader.textContent = 'Reference';
  }

  const theme = getVizThemeColors();
  renderer.init(canvas, {
    width,
    height,
    devicePixelRatio: window.devicePixelRatio,
    backgroundColor: theme.backgroundColor,
    poincareDiskFillColor: theme.diskFillColor,
    poincareDiskBorderColor: theme.diskBorderColor,
    poincareGridColor: theme.gridColor,
  });

  currentGeometry = geometry;
  currentRendererType = rendererType;
}

function resizeOverlay(width: number, height: number): void {
  // Overlay is UI-only (lasso). Keep it at DPR=1 for performance.
  // Clearing/drawing a DPR=2 overlay every frame can noticeably hurt FPS.
  const dpr = 1;
  overlayCanvas.width = Math.max(1, Math.floor(width * dpr));
  overlayCanvas.height = Math.max(1, Math.floor(height * dpr));
  overlayCanvas.style.width = `${width}px`;
  overlayCanvas.style.height = `${height}px`;

  const ctx = overlayCanvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
}

function getSelectedGeometry(): GeometryMode {
  const el = document.querySelector<HTMLInputElement>('input[name="geometry"]:checked');
  return (el?.value as GeometryMode) ?? 'euclidean';
}

function getSelectedRendererType(): RendererType {
  const el = document.querySelector<HTMLInputElement>('input[name="renderer"]:checked');
  return (el?.value as RendererType) ?? 'webgl';
}

function getSelectedDatasetDistribution(): DatasetDistribution {
  return (datasetModeSelect?.value as DatasetDistribution) ?? 'default';
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${n / 1_000_000}M`;
  if (n >= 1_000) return `${n / 1_000}K`;
  return `${n}`;
}

function getPointCount(): number {
  const i = Math.max(0, Math.min(POINT_PRESETS.length - 1, parseInt(numPointsInput.value, 10) || 0));
  return POINT_PRESETS[i];
}

function syncPointLabel(): void {
  numPointsLabel.textContent = formatCount(getPointCount());
}

let generateTimer: number | null = null;
function scheduleGenerateAndLoad(): void {
  if (generateTimer !== null) window.clearTimeout(generateTimer);
  generateTimer = window.setTimeout(() => {
    generateTimer = null;
    generateAndLoad();
  }, 150);
}

/**
 * Generate and load a new dataset.
 */
function generateAndLoad(): void {
  const rendererType = getSelectedRendererType();
  const geometry = getSelectedGeometry();
  const n = getPointCount();
  const labelCount = parseInt(labelCountInput.value, 10);
  const seed = parseInt(seedInput.value, 10);
  const distribution = getSelectedDatasetDistribution();

  const datasetKey = `${geometry}/${distribution}/${n}/${labelCount}/${seed}`;
  const needsNewDataset = !dataset || datasetKey !== lastDatasetKey;

  // Cancel any in-flight selection job.
  selectionJobId++;

  // Initialize renderer if needed (geometry or renderer type changed)
  if (currentGeometry !== geometry || currentRendererType !== rendererType || !renderer) {
    initRenderer(geometry, rendererType);
  }

  // Generate dataset only if inputs changed.
  if (needsNewDataset) {
    dataset = generateDataset({
      seed,
      n,
      labelCount,
      geometry,
      distribution,
    });
    lastDatasetKey = datasetKey;
  }

  // Load dataset
  renderer!.setDataset(dataset!);

  // Update stats
  statPoints.textContent = n.toLocaleString();
  statSelected.textContent = '0';
  statHovered.textContent = '-';
  statFrameTime.textContent = '—';
  statFrameTime.style.color = '';
  statLassoTime.textContent = '—';
  frameTimes.length = 0; // Reset frame time tracking
  frameIntervals.length = 0;
  lastRafTs = 0;

  // Clear overlay UI.
  {
    overlayCanvas.style.display = 'none';
    const ctx = overlayCanvas.getContext('2d');
    if (ctx) {
      const rect = canvasBody.getBoundingClientRect();
      ctx.clearRect(0, 0, rect.width, rect.height);
    }
  }

  // Render
  requestRender();
}

/**
 * Request a render frame.
 */
function requestRender(): void {
  needsRender = true;
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(tick);
}

function tick(ts: number): void {
  rafPending = false;

  // Track actual frame interval (what people perceive as FPS).
  if (lastRafTs !== 0) {
    frameIntervals.push(ts - lastRafTs);
    if (frameIntervals.length > 60) frameIntervals.shift();
  }
  lastRafTs = ts;

  if (needsRender) {
    needsRender = false;
    render();
  }

  // Keep animating during interaction so motion stays smooth even if input
  // events arrive irregularly.
  if (isDragging || isLassoing || hoverDirty) {
    requestRender();
  }
}

/**
 * Render the current frame.
 */
function render(): void {
  if (!renderer) return;

  // Apply coalesced pan at most once per frame.
  // Important: apply even if the drag ended before this frame executed.
  if (renderer && (pendingPanDx !== 0 || pendingPanDy !== 0)) {
    renderer.pan(pendingPanDx, pendingPanDy, pendingModifiers);
    pendingPanDx = 0;
    pendingPanDy = 0;
  }

  // Throttle hover hit-test to once per frame.
  if (!isDragging && !isLassoing && hoverDirty && renderer) {
    const hit = renderer.hitTest(pendingHoverX, pendingHoverY);
    if (hit) {
      renderer.setHovered(hit.index);
      statHovered.textContent = `#${hit.index}`;
    } else {
      renderer.setHovered(-1);
      statHovered.textContent = '-';
    }
    hoverDirty = false;
  }

  const startTime = performance.now();
  renderer.render();
  const endTime = performance.now();

  // Track frame time
  const frameTime = endTime - startTime;
  frameTimes.push(frameTime);
  if (frameTimes.length > 60) frameTimes.shift();

  // Update frame time display (every 10 frames)
  frameCount++;
  if (frameCount % 10 === 0) {
    const avgCpuMs = frameTimes.reduce((a, b) => a + b, 0) / Math.max(1, frameTimes.length);
    const avgIntervalMs = frameIntervals.reduce((a, b) => a + b, 0) / Math.max(1, frameIntervals.length);
    const fps = avgIntervalMs > 1e-6 ? (1000 / avgIntervalMs) : 0;
    statFrameTime.textContent = `fps ${fps.toFixed(1)} · cpu ${avgCpuMs.toFixed(2)}ms`;
    statFrameTime.style.color = fps >= 50 ? '#8b8' : '#b66';
  }

  // Draw lasso only while actively drawing.
  if (isLassoing) {
    // Continuously simplify while dragging to keep overlay + selection snappy.
    // (Embedding Atlas uses simplifyPolygon(points, 24).)
    if (lassoDirty) {
      lassoDirty = false;
      if (lassoRawDataPoints.length >= 6) {
        lassoActiveDataPolygon = simplifyPolygonData(lassoRawDataPoints, LASSO_MAX_VERTS_INTERACTION);
      } else {
        lassoActiveDataPolygon = null;
      }
    }
  }

  // Overlay rendering is UI-only; keep it decoupled from WebGL.
  // - While dragging, draw the (simplified) in-progress lasso in screen space.
  // - When not dragging, draw the persisted lasso projected from data space.
  if (isLassoing && lassoActiveDataPolygon && lassoActiveDataPolygon.length >= 6) {
    drawLassoData(lassoActiveDataPolygon);
  } else if (rangeSelectionDataPolygon && rangeSelectionDataPolygon.length >= 6) {
    drawLassoData(rangeSelectionDataPolygon);
  } else {
    // Nothing to show.
    overlayCanvas.style.display = 'none';
    const ctx = overlayCanvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  }
}

/**
 * Draw a lasso polygon given in SCREEN SPACE (interleaved x,y).
 */
function drawLassoScreen(polyline: Float32Array): void {
  overlayCanvas.style.display = 'block';
  const ctx = overlayCanvas.getContext('2d');
  if (!ctx) return;

  const width = overlayCanvas.width;
  const height = overlayCanvas.height;
  ctx.clearRect(0, 0, width, height);

  if (polyline.length < 6) return;

  ctx.strokeStyle = '#cccccc';
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.moveTo(polyline[0], polyline[1]);
  for (let i = 2; i < polyline.length; i += 2) {
    ctx.lineTo(polyline[i], polyline[i + 1]);
  }
  ctx.closePath();
  ctx.stroke();

  ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.fill();
}

/**
 * Draw a lasso polygon given in DATA SPACE (interleaved x,y).
 * The overlay is projected each frame so it tracks pan/zoom correctly.
 */
function drawLassoData(polygonData: Float32Array): void {
  if (!renderer) return;

  const n = polygonData.length / 2;
  if (n < 3) return;

  drawLassoScreen(projectDataPolygonToScreen(polygonData));
}

/**
 * Update the mode indicator.
 */
function updateModeIndicator(): void {
  modeIndicator.textContent = mode.toUpperCase();
  modeIndicator.className = `mode ${mode}`;
}

// === Event Handlers ===

function handleMouseDown(e: MouseEvent): void {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  lastMouseX = x;
  lastMouseY = y;

  // Embedding Atlas gesture:
  // - momentary lasso: Shift + Meta (Cmd on macOS) or Shift + Ctrl
  const wantsLasso = e.shiftKey && (e.metaKey || e.ctrlKey);

  // Plain click clears the persistent range selection (lasso overlay).
  // This matches the Embedding Atlas behavior: rangeSelection persists until cleared.
  // NOTE: We only clear range selection here; point selection is preserved.
  if (!wantsLasso && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && rangeSelectionDataPolygon) {
    rangeSelectionDataPolygon = null;
    // Cancel any in-flight selection materialization since the predicate changed.
    selectionJobId++;
    requestRender();
  }

  if (wantsLasso) {
    if (!renderer) return;
    mode = 'lasso';
    isLassoing = true;
    overlayCanvas.style.display = 'block';
    const d0 = renderer.unprojectFromScreen(x, y);
    lassoRawDataPoints = [d0.x, d0.y];
    lassoActiveDataPolygon = null;
    lassoLastScreenX = x;
    lassoLastScreenY = y;
    lassoDirty = true;
    statSelected.textContent = '0';
    updateModeIndicator();
    requestRender();
  } else {
    // Start pan
    mode = 'pan';
    isDragging = true;
    updateModeIndicator();

    pendingPanDx = 0;
    pendingPanDy = 0;
    pendingModifiers = {
      shift: e.shiftKey,
      ctrl: e.ctrlKey,
      alt: e.altKey,
      meta: e.metaKey,
    };

    // For hyperbolic, notify start of pan
    if (renderer && 'startPan' in renderer) {
      (renderer as any).startPan(x, y);
    }

    requestRender();
  }
}

function handleMouseMove(e: MouseEvent): void {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  if (isDragging && renderer) {
    const deltaX = x - lastMouseX;
    const deltaY = y - lastMouseY;
    pendingPanDx += deltaX;
    pendingPanDy += deltaY;
    pendingModifiers = {
      shift: e.shiftKey,
      ctrl: e.ctrlKey,
      alt: e.altKey,
      meta: e.metaKey,
    };
    lastMouseX = x;
    lastMouseY = y;
    requestRender();
  } else if (isLassoing) {
    // Avoid capturing every single mousemove event (can be thousands of vertices).
    // Sample only when we moved enough in screen space.
    const dx = x - lassoLastScreenX;
    const dy = y - lassoLastScreenY;
    if (dx * dx + dy * dy >= LASSO_MIN_SAMPLE_DIST_PX * LASSO_MIN_SAMPLE_DIST_PX) {
      if (renderer) {
        const d = renderer.unprojectFromScreen(x, y);
        lassoRawDataPoints.push(d.x, d.y);
        lassoDirty = true;
      }
      lassoLastScreenX = x;
      lassoLastScreenY = y;
    }
    requestRender();
  } else if (renderer) {
    // Hover test (throttled to rAF)
    pendingHoverX = x;
    pendingHoverY = y;
    hoverDirty = true;
    requestRender();
  }
}

function handleMouseUp(_e: MouseEvent): void {
  // Flush any pending pan deltas *before* clearing state.
  // Otherwise, releasing the mouse before the scheduled rAF frame runs can
  // drop the final (or entire) pan and appear as if the view snaps back.
  if (renderer && (pendingPanDx !== 0 || pendingPanDy !== 0)) {
    renderer.pan(pendingPanDx, pendingPanDy, pendingModifiers);
    pendingPanDx = 0;
    pendingPanDy = 0;
  }

  if (isLassoing && renderer && lassoRawDataPoints.length >= 6) {
    // Complete lasso selection.
    const dataPoly = lassoActiveDataPolygon ?? simplifyPolygonData(lassoRawDataPoints, LASSO_MAX_VERTS_FINAL);
    const screenPolyline = projectDataPolygonToScreen(dataPoly);
    const result = renderer.lassoSelect(screenPolyline);

    // Persist the range selection overlay in DATA SPACE (so it tracks pan/zoom).
    rangeSelectionDataPolygon = dataPoly;

    // Apply selection (Embedding Atlas style): keep only the range-selection
    // overlay (no point highlighting) and compute an exact count asynchronously.
    renderer.setSelection(new Set());
    statSelected.textContent = '…';
    const jobId = ++selectionJobId;
    void countSelectionAsync(jobId, result);
    statLassoTime.textContent = `${result.computeTimeMs.toFixed(2)}ms`;
  }

  isDragging = false;
  isLassoing = false;
  lassoRawDataPoints = [];
  lassoActiveDataPolygon = null;
  lassoDirty = false;
  pendingPanDx = 0;
  pendingPanDy = 0;
  hoverDirty = false;

  // If the renderer supports it, tell it the interaction is over so the next
  // render uses the stable (non-interaction) policy immediately.
  // This avoids a visible LOD "pop" when the next hover-triggered render would
  // otherwise switch from interaction subsampling back to full detail.
  if (renderer && 'endInteraction' in (renderer as any)) {
    (renderer as any).endInteraction();
  }

  // Do NOT hide the overlay here: Embedding Atlas keeps range selection visible
  // until explicitly cleared (plain click / dbl-click).
  mode = 'pan';
  updateModeIndicator();
  requestRender();
}

function handleWheel(e: WheelEvent): void {
  e.preventDefault();
  if (!renderer) return;

  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  // Normalize wheel delta
  const delta = -e.deltaY / 100;

  renderer.zoom(x, y, delta, {
    shift: e.shiftKey,
    ctrl: e.ctrlKey,
    alt: e.altKey,
    meta: e.metaKey,
  });

  requestRender();
}

function handleDoubleClick(): void {
  if (!renderer) return;

  // Clear selection
  selectionJobId++;
  renderer.setSelection(new Set());
  statSelected.textContent = '0';

  // Hide overlay since range selection is cleared.
  rangeSelectionDataPolygon = null;
  overlayCanvas.style.display = 'none';
  const ctx = overlayCanvas.getContext('2d');
  if (ctx) ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  requestRender();
}

function handleResize(): void {
  if (!renderer) return;

  const rect = canvasBody.getBoundingClientRect();
  const width = Math.floor(rect.width);
  const height = Math.floor(rect.height);

  renderer.resize(width, height);
  resizeOverlay(width, height);
  requestRender();
}

// === Initialization ===

// Set up event listeners
canvas.addEventListener('mousedown', handleMouseDown);
canvas.addEventListener('mousemove', handleMouseMove);
canvas.addEventListener('mouseup', handleMouseUp);
canvas.addEventListener('mouseleave', handleMouseUp);
canvas.addEventListener('wheel', handleWheel, { passive: false });
canvas.addEventListener('dblclick', handleDoubleClick);
window.addEventListener('resize', handleResize);

for (const el of geometryInputs) el.addEventListener('change', scheduleGenerateAndLoad);
for (const el of rendererInputs) el.addEventListener('change', scheduleGenerateAndLoad);
datasetModeSelect.addEventListener('change', scheduleGenerateAndLoad);
numPointsInput.addEventListener('input', () => {
  syncPointLabel();
  scheduleGenerateAndLoad();
});
numPointsInput.addEventListener('change', () => {
  syncPointLabel();
  scheduleGenerateAndLoad();
});
labelCountInput.addEventListener('input', () => {
  if (labelCountLabel) labelCountLabel.textContent = labelCountInput.value;
  scheduleGenerateAndLoad();
});
labelCountInput.addEventListener('change', () => {
  if (labelCountLabel) labelCountLabel.textContent = labelCountInput.value;
  scheduleGenerateAndLoad();
});
seedInput.addEventListener('change', scheduleGenerateAndLoad);

// Re-init renderer when color scheme changes
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (renderer) {
    initRenderer(currentGeometry, currentRendererType);
    if (dataset) renderer.setDataset(dataset);
    requestRender();
  }
});

// Initial generation
syncPointLabel();
if (labelCountLabel) labelCountLabel.textContent = labelCountInput.value;
generateAndLoad();

console.log('Viz Lab initialized');
