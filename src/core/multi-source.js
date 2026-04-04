/**
 * Multi-source and multi-listener management
 * Supports placing multiple source/listener markers and computing
 * propagation independently for each pair.
 */

const Cesium = window.Cesium;
import { state } from './state.js';
import { CONFIG, CESIUM_COLORS, getCartesian3 } from './physics.js';

let nextSourceId = 1;
let nextListenerId = 1;

const SOURCE_COLORS = [
  '#ff3d71', '#ff6b35', '#ffc107', '#e91e63',
  '#9c27b0', '#ff5722', '#f44336', '#ff8a65',
];

const LISTENER_COLORS = [
  '#64ffda', '#00e5ff', '#18ffff', '#84ffff',
  '#a7ffeb', '#b2ff59', '#69f0ae', '#00e676',
];

/**
 * Add a new source at the given position
 */
export function addSource(viewer, pos, wavPath = null) {
  const id = nextSourceId++;
  const color = SOURCE_COLORS[(id - 1) % SOURCE_COLORS.length];
  const cesiumColor = Cesium.Color.fromCssColorString(color);

  const cartesian = getCartesian3(pos);
  const entity = viewer.entities.add({
    position: cartesian,
    point: {
      pixelSize: 12,
      color: cesiumColor,
      outlineColor: Cesium.Color.WHITE.withAlpha(0.6),
      outlineWidth: 2,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    label: {
      text: `SRC-${id}`,
      font: '10px JetBrains Mono, monospace',
      fillColor: cesiumColor,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      pixelOffset: new Cesium.Cartesian2(0, -20),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  });

  const source = {
    id,
    pos: { ...pos },
    entity,
    color,
    wavPath,
    audioBuffer: null,
  };
  state.sources.push(source);
  return source;
}

/**
 * Add a new listener at the given position
 */
export function addListener(viewer, pos) {
  const id = nextListenerId++;
  const color = LISTENER_COLORS[(id - 1) % LISTENER_COLORS.length];
  const cesiumColor = Cesium.Color.fromCssColorString(color);

  const cartesian = getCartesian3(pos);
  const entity = viewer.entities.add({
    position: cartesian,
    point: {
      pixelSize: 12,
      color: cesiumColor,
      outlineColor: Cesium.Color.WHITE.withAlpha(0.6),
      outlineWidth: 2,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    label: {
      text: `MIC-${id}`,
      font: '10px JetBrains Mono, monospace',
      fillColor: cesiumColor,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      pixelOffset: new Cesium.Cartesian2(0, -20),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  });

  const listener = {
    id,
    pos: { ...pos },
    entity,
    color,
  };
  state.listeners.push(listener);
  return listener;
}

/**
 * Remove a source by id
 */
export function removeSource(viewer, id) {
  const idx = state.sources.findIndex((s) => s.id === id);
  if (idx >= 0) {
    viewer.entities.remove(state.sources[idx].entity);
    state.sources.splice(idx, 1);
  }
}

/**
 * Remove a listener by id
 */
export function removeListener(viewer, id) {
  const idx = state.listeners.findIndex((l) => l.id === id);
  if (idx >= 0) {
    viewer.entities.remove(state.listeners[idx].entity);
    state.listeners.splice(idx, 1);
  }
}

/**
 * Parse receiver positions from KMZ/KML content
 * Extracts placemarks as receiver positions
 */
export function parseKMLReceivers(kmlString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(kmlString, 'text/xml');
  const placemarks = doc.querySelectorAll('Placemark');
  const receivers = [];

  placemarks.forEach((pm) => {
    const nameEl = pm.querySelector('name');
    const coordsEl = pm.querySelector('coordinates');
    if (!coordsEl) return;

    const coordsText = coordsEl.textContent.trim();
    const parts = coordsText.split(',').map((s) => parseFloat(s.trim()));
    if (parts.length < 2) return;

    receivers.push({
      name: nameEl ? nameEl.textContent.trim() : `Receiver ${receivers.length + 1}`,
      lon: parts[0],
      lat: parts[1],
      height: parts.length > 2 ? parts[2] : 1.5,
    });
  });

  return receivers;
}

/**
 * Add receiver markers from parsed KML data
 */
export function addReceivers(viewer, receivers) {
  receivers.forEach((recv, i) => {
    const cartesian = Cesium.Cartesian3.fromDegrees(
      recv.lon,
      recv.lat,
      CONFIG.defaultCenter.height + recv.height
    );

    const entity = viewer.entities.add({
      position: cartesian,
      point: {
        pixelSize: 8,
        color: Cesium.Color.CYAN.withAlpha(0.7),
        outlineColor: Cesium.Color.WHITE.withAlpha(0.4),
        outlineWidth: 1,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: recv.name,
        font: '9px JetBrains Mono, monospace',
        fillColor: Cesium.Color.CYAN,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -16),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });

    state.receivers.push({ ...recv, entity });
  });
}

/**
 * Clear all additional sources/listeners/receivers
 */
export function clearAll(viewer) {
  state.sources.forEach((s) => viewer.entities.remove(s.entity));
  state.listeners.forEach((l) => viewer.entities.remove(l.entity));
  state.receivers.forEach((r) => viewer.entities.remove(r.entity));
  state.sources = [];
  state.listeners = [];
  state.receivers = [];
}
