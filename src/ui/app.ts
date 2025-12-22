/**
 * Demo application for the viz-lab.
 * Provides interactive UI for testing reference implementations.
 */

import { Dataset, GeometryMode, Renderer, InteractionMode } from '../core/types.js';
import { generateDataset } from '../core/dataset.js';
import { EuclideanReference } from '../impl_reference/euclidean_reference.js';
import { HyperbolicReference } from '../impl_reference/hyperbolic_reference.js';

// DOM elements
const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const canvasBody = document.getElementById('canvasBody') as HTMLDivElement;
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
let mode: InteractionMode = 'pan';

// Interaction state
let isDragging = false;
let isLassoing = false;
let lastMouseX = 0;
let lastMouseY = 0;
let lassoPoints: number[] = [];

// Performance tracking
let frameCount = 0;
let lastFrameTime = 0;
const frameTimes: number[] = [];

/**
 * Initialize the renderer based on geometry.
 */
function initRenderer(geometry: GeometryMode): void {
  if (renderer) {
    renderer.destroy();
  }

  const rect = canvasBody.getBoundingClientRect();
  const width = Math.floor(rect.width);
  const height = Math.floor(rect.height);

  if (geometry === 'euclidean') {
    renderer = new EuclideanReference();
  } else {
    renderer = new HyperbolicReference();
  }

  renderer.init(canvas, {
    width,
    height,
    devicePixelRatio: window.devicePixelRatio,
  });

  currentGeometry = geometry;
}

/**
 * Generate and load a new dataset.
 */
function generateAndLoad(): void {
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

  // Initialize renderer if needed
  if (currentGeometry !== geometry || !renderer) {
    initRenderer(geometry);
  }

  // Load dataset
  renderer!.setDataset(dataset);

  // Update stats
  statPoints.textContent = n.toLocaleString();
  statSelected.textContent = '0';
  statHovered.textContent = '-';

  // Render
  requestRender();
}

/**
 * Request a render frame.
 */
function requestRender(): void {
  requestAnimationFrame(render);
}

/**
 * Render the current frame.
 */
function render(): void {
  if (!renderer) return;

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
    const avgFrameTime = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
    statFrameTime.textContent = `${avgFrameTime.toFixed(2)}ms`;
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
  const ctx = canvas.getContext('2d')!;
  const dpr = window.devicePixelRatio;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);

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

  ctx.restore();
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
    lassoPoints = [x, y];
    updateModeIndicator();
  } else {
    // Start pan
    mode = 'pan';
    isDragging = true;
    updateModeIndicator();

    // For hyperbolic, notify start of pan
    if (renderer && 'startPan' in renderer) {
      (renderer as HyperbolicReference).startPan(x, y);
    }
  }
}

function handleMouseMove(e: MouseEvent): void {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  if (isDragging && renderer) {
    const deltaX = x - lastMouseX;
    const deltaY = y - lastMouseY;
    renderer.pan(deltaX, deltaY, {
      shift: e.shiftKey,
      ctrl: e.ctrlKey,
      alt: e.altKey,
      meta: e.metaKey,
    });
    lastMouseX = x;
    lastMouseY = y;
    requestRender();
  } else if (isLassoing) {
    lassoPoints.push(x, y);
    requestRender();
  } else if (renderer) {
    // Hover test
    const hit = renderer.hitTest(x, y);
    if (hit) {
      renderer.setHovered(hit.index);
      statHovered.textContent = `#${hit.index}`;
    } else {
      renderer.setHovered(-1);
      statHovered.textContent = '-';
    }
    requestRender();
  }
}

function handleMouseUp(e: MouseEvent): void {
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

// Initial generation
generateAndLoad();

console.log('Viz Lab initialized');
