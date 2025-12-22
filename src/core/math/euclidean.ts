/**
 * Euclidean geometry utilities.
 */

import { EuclideanViewState } from '../types.js';

/**
 * Create a default Euclidean view state.
 */
export function createEuclideanView(): EuclideanViewState {
  return {
    type: 'euclidean',
    centerX: 0,
    centerY: 0,
    zoom: 1,
  };
}

/**
 * Project a data point to screen coordinates.
 */
export function projectEuclidean(
  dataX: number,
  dataY: number,
  view: EuclideanViewState,
  width: number,
  height: number
): { x: number; y: number } {
  const scale = Math.min(width, height) * 0.4 * view.zoom;
  const x = width / 2 + (dataX - view.centerX) * scale;
  const y = height / 2 - (dataY - view.centerY) * scale; // flip Y
  return { x, y };
}

/**
 * Unproject screen coordinates to data space.
 */
export function unprojectEuclidean(
  screenX: number,
  screenY: number,
  view: EuclideanViewState,
  width: number,
  height: number
): { x: number; y: number } {
  const scale = Math.min(width, height) * 0.4 * view.zoom;
  const x = view.centerX + (screenX - width / 2) / scale;
  const y = view.centerY - (screenY - height / 2) / scale; // flip Y
  return { x, y };
}

/**
 * Apply pan to view (anchor-invariant: point under cursor stays under cursor).
 */
export function panEuclidean(
  view: EuclideanViewState,
  deltaScreenX: number,
  deltaScreenY: number,
  width: number,
  height: number
): EuclideanViewState {
  const scale = Math.min(width, height) * 0.4 * view.zoom;
  return {
    ...view,
    centerX: view.centerX - deltaScreenX / scale,
    centerY: view.centerY + deltaScreenY / scale, // flip Y
  };
}

/**
 * Apply zoom to view (anchor-invariant: point under cursor stays under cursor).
 */
export function zoomEuclidean(
  view: EuclideanViewState,
  anchorScreenX: number,
  anchorScreenY: number,
  delta: number,
  width: number,
  height: number
): EuclideanViewState {
  // Get data point under anchor before zoom
  const anchorData = unprojectEuclidean(anchorScreenX, anchorScreenY, view, width, height);

  // Apply zoom (delta > 0 = zoom in)
  const zoomFactor = Math.pow(1.1, delta);
  const newZoom = Math.max(0.1, Math.min(100, view.zoom * zoomFactor));

  // Calculate new center so anchor point stays in place
  const newScale = Math.min(width, height) * 0.4 * newZoom;
  const newCenterX = anchorData.x - (anchorScreenX - width / 2) / newScale;
  const newCenterY = anchorData.y + (anchorScreenY - height / 2) / newScale;

  return {
    ...view,
    centerX: newCenterX,
    centerY: newCenterY,
    zoom: newZoom,
  };
}
