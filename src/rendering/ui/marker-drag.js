/**
 * Drag-and-drop for SRC and MIC markers on the Cesium globe
 * Click a marker to pick it up, move mouse to reposition, click again to drop.
 */

const Cesium = window.Cesium;
import { state } from '../../core/state.js';
import { CONFIG } from '../../core/physics.js';

let dragTarget = null; // 'source' | 'listener' | null
let isDragging = false;

export function initMarkerDrag(viewer, onPositionChanged) {
  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

  // ─── Left click: pick up or drop a marker ───
  handler.setInputAction((click) => {
    if (isDragging) {
      // Drop
      const pos = screenToLatLon(viewer, click.position);
      if (pos) applyPosition(pos);
      finishDrag(viewer);
      // Recompute on drop (non-blocking via setTimeout so UI unblocks first)
      setTimeout(() => {
        if (onPositionChanged) onPositionChanged();
      }, 0);
      return;
    }

    // Try to pick a marker
    const picked = viewer.scene.pick(click.position);
    if (!Cesium.defined(picked) || !picked.id) return;

    if (picked.id === state.entities.listenerPoint) {
      startDrag(viewer, 'listener');
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  // ─── Mouse move ───
  handler.setInputAction((movement) => {
    if (!isDragging || !dragTarget) {
      // Hover cursor
      const picked = viewer.scene.pick(movement.endPosition);
      if (Cesium.defined(picked) && picked.id &&
          picked.id === state.entities.listenerPoint) {
        viewer.scene.canvas.style.cursor = 'grab';
      } else {
        viewer.scene.canvas.style.cursor = '';
      }
      return;
    }

    const pos = screenToLatLon(viewer, movement.endPosition);
    if (!pos) return;

    applyPosition(pos);
    updateVisuals();
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

  // ─── Right click: cancel drag ───
  handler.setInputAction(() => {
    if (isDragging) finishDrag(viewer);
  }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);
}

function startDrag(viewer, target) {
  dragTarget = target;
  isDragging = true;
  viewer.scene.screenSpaceCameraController.enableInputs = false;
  viewer.scene.canvas.style.cursor = 'grabbing';
}

function finishDrag(viewer) {
  isDragging = false;
  dragTarget = null;
  viewer.scene.screenSpaceCameraController.enableInputs = true;
  viewer.scene.canvas.style.cursor = '';
}

function screenToLatLon(viewer, screenPos) {
  const cartesian = viewer.camera.pickEllipsoid(screenPos, viewer.scene.globe.ellipsoid);
  if (!cartesian) return null;
  const carto = Cesium.Cartographic.fromCartesian(cartesian);
  return {
    lat: Cesium.Math.toDegrees(carto.latitude),
    lon: Cesium.Math.toDegrees(carto.longitude),
  };
}

function applyPosition(pos) {
  state.listener.lat = pos.lat;
  state.listener.lon = pos.lon;
  setVal('micLat', pos.lat.toFixed(5));
  setVal('micLon', pos.lon.toFixed(5));
}

/** Cheap visual-only update during drag — no computation */
function updateVisuals() {
  if (state.entities.listenerPoint) {
    state.entities.listenerPoint.position =
      Cesium.Cartesian3.fromDegrees(state.listener.lon, state.listener.lat);
  }
}

function setVal(id, v) {
  const el = document.getElementById(id);
  if (el) el.value = v;
}
