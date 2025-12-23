/**
 * Demo application for the viz-lab.
 * Provides interactive UI for testing reference implementations.
 */

import { Dataset, GeometryMode, Renderer, InteractionMode, Modifiers } from '../core/types.js';
import { generateDataset } from '../core/dataset.js';
import { EuclideanReference } from '../impl_reference/euclidean_reference.js';
import { HyperbolicReference } from '../impl_reference/hyperbolic_reference.js';
import { EuclideanWebGLCandidate, HyperbolicWebGLCandidate } from '../impl_candidate/webgl_candidate.js';

type RendererType = 'webgl' | 'reference';

// DOM elements
let canvas = document.getElementById('canvas') as HTMLCanvasElement;
const overlayCanvas = document.getElementById('overlayCanvas') as HTMLCanvasElement;
const canvasBody = document.getElementById('canvasBody') as HTMLDivElement;
const canvasHeader = document.getElementById('canvasHeader') as HTMLDivElement;
const rendererSelect = document.getElementById('renderer') as HTMLSelectElement;
const geometrySelect = document.getElementById('geometry') as HTMLSelectElement;
const numPointsSelect = document.getElementById('numPoints') as HTMLSelectElement;
const labelCountInput = document.getElementById('labelCount') as HTMLInputElement;
const seedInput = document.getElementById('seed') as HTMLInputElement;
const generateBtn = document.getElementById('generateBtn') as HTMLButtonElement;
const modeIndicator = document.getElementById('modeIndicator') as HTMLDivElement;

// Stats elements
const statPoints = document.getElementById('statPoints') as HTMLSpanElement;
const statSelected = document.getElementById('statSelected') as HTMLSpanElement;
const statHovered = document.getElementById('statHovered') as HTMLSpanElement;
const statFrameTime = document.getElementById('statFrameTime') as HTMLSpanElement;
const statLassoTime = document.getElementById('statLassoTime') as HTMLSpanElement;

// State
let renderer: Renderer | null = null;
let dataset: Dataset | null = null;
let currentGeometry: GeometryMode = 'euclidean';
let currentRendererType: RendererType = 'webgl';
let mode: InteractionMode = 'pan';

// Interaction state
let isDragging = false;
let isLassoing = false;
let lastMouseX = 0;
let lastMouseY = 0;
let lassoPoints: number[] = [];

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
    canvasHeader.textContent = 'WebGL Renderer';
  } else {
    if (geometry === 'euclidean') {
      renderer = new EuclideanReference();
    } else {
      renderer = new HyperbolicReference();
    }
    canvasHeader.textContent = 'Reference (Canvas2D)';
  }

  renderer.init(canvas, {
    width,
    height,
    devicePixelRatio: window.devicePixelRatio,
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

/**
 * Generate and load a new dataset.
 */
function generateAndLoad(): void {
  const rendererType = rendererSelect.value as RendererType;
  const geometry = geometrySelect.value as GeometryMode;
  const n = parseInt(numPointsSelect.value, 10);
  const labelCount = parseInt(labelCountInput.value, 10);
  const seed = parseInt(seedInput.value, 10);

  // Generate dataset
  dataset = generateDataset({
    seed,
    n,
    labelCount,
    geometry,
  });

  // Initialize renderer if needed (geometry or renderer type changed)
  if (currentGeometry !== geometry || currentRendererType !== rendererType || !renderer) {
    initRenderer(geometry, rendererType);
  }

  // Load dataset
  renderer!.setDataset(dataset);

  // Update stats
  statPoints.textContent = n.toLocaleString();
  statSelected.textContent = '0';
  statHovered.textContent = '-';
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
    statFrameTime.textContent = `${avgIntervalMs.toFixed(2)}ms (${fps.toFixed(1)} FPS, cpu ${avgCpuMs.toFixed(2)}ms)`;
  }

  // Draw lasso if active
  if (isLassoing && lassoPoints.length >= 4) {
    drawLasso();
  }
}

/**
 * Draw the lasso selection polygon.
 */
function drawLasso(): void {
  // Only show overlay when actively drawing.
  overlayCanvas.style.display = 'block';
  const ctx = overlayCanvas.getContext('2d');
  if (!ctx) return;

  const rect = canvasBody.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;
  ctx.clearRect(0, 0, width, height);

  // Draw lasso path
  ctx.strokeStyle = '#ff66aa';
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.moveTo(lassoPoints[0], lassoPoints[1]);
  for (let i = 2; i < lassoPoints.length; i += 2) {
    ctx.lineTo(lassoPoints[i], lassoPoints[i + 1]);
  }
  ctx.closePath();
  ctx.stroke();

  // Fill with transparent color
  ctx.fillStyle = 'rgba(255, 102, 170, 0.1)';
  ctx.fill();
}

/**
 * Update the mode indicator.
 */
function updateModeIndicator(): void {
  modeIndicator.textContent = mode.toUpperCase();
  modeIndicator.className = `mode-indicator ${mode}`;
}

// === Event Handlers ===

function handleMouseDown(e: MouseEvent): void {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  lastMouseX = x;
  lastMouseY = y;

  if (e.shiftKey) {
    // Start lasso
    mode = 'lasso';
    isLassoing = true;
    overlayCanvas.style.display = 'block';
    lassoPoints = [x, y];
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
    lassoPoints.push(x, y);
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

  if (isLassoing && renderer && lassoPoints.length >= 6) {
    // Complete lasso selection
    const polyline = new Float32Array(lassoPoints);
    const result = renderer.lassoSelect(polyline);
    renderer.setSelection(result.indices);
    statSelected.textContent = result.indices.size.toLocaleString();
    statLassoTime.textContent = `${result.computeTimeMs.toFixed(2)}ms`;
  }

  isDragging = false;
  isLassoing = false;
  lassoPoints = [];
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
  // Clear overlay lasso.
  {
    overlayCanvas.style.display = 'none';
    const ctx = overlayCanvas.getContext('2d');
    if (ctx) {
      const rect = canvasBody.getBoundingClientRect();
      ctx.clearRect(0, 0, rect.width, rect.height);
    }
  }
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
  renderer.setSelection(new Set());
  statSelected.textContent = '0';
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

generateBtn.addEventListener('click', generateAndLoad);
geometrySelect.addEventListener('change', generateAndLoad);
rendererSelect.addEventListener('change', generateAndLoad);

// Initial generation
generateAndLoad();

console.log('Viz Lab initialized');
