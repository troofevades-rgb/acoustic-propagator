/**
 * Reflection path visualization and management
 * Bridges physics computation → visual entities
 */

import { state } from '../core/state.js';
import {
  computePlanarReflections,
  computeRayTracedReflections,
  distanceBetween,
} from '../core/physics.js';

let rayTraceTimeout = null;

/**
 * Recompute reflections based on current mode and positions.
 * Always computes fast planar reflections first.
 * If mode is 'auto', schedules ray tracing after a debounce.
 */
export function recomputeReflections(onRayTraceComplete) {
  state.directDistance = distanceBetween(state.source, state.listener);
  state.directTime = state.directDistance / state.speedOfSound;

  // Always start with fast planar reflections
  state.reflections = computePlanarReflections(
    state.source,
    state.listener,
    state.speedOfSound
  );

  // Schedule ray tracing if auto mode — debounced so rapid moves don't pile up
  if (state.reflectionMode === 'auto' && state.viewer && state.tileset) {
    if (rayTraceTimeout) clearTimeout(rayTraceTimeout);
    rayTraceTimeout = setTimeout(() => {
      try {
        state.reflections = computeRayTracedReflections(
          state.viewer,
          state.source,
          state.listener,
          state.speedOfSound,
          state.rayTraceCache
        );
        if (onRayTraceComplete) onRayTraceComplete();
      } catch (e) {
        console.warn('Ray tracing failed:', e);
      }
    }, 500);
  }
}

/**
 * Clear ray trace cache (e.g., when positions change significantly)
 */
export function clearRayTraceCache() {
  state.rayTraceCache.clear();
}
