/**
 * Listener marker, DOA arrow, measurement overlays
 *
 * The app is listener-centric: the MIC position is where the recording device was.
 * The direction of arrival (DOA) comes from the spatial audio data itself —
 * no manually placed source needed.
 */

const Cesium = window.Cesium;
import { state } from '../core/state.js';
import { CONFIG, CESIUM_COLORS, getCartesian3 } from '../core/physics.js';

/**
 * Create listener marker and DOA arrow entities
 */
export function createMarkerEntities(viewer) {
  // Listener / recording device marker
  state.entities.listenerPoint = viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(state.listener.lon, state.listener.lat),
    point: {
      pixelSize: 16,
      color: CESIUM_COLORS.listener,
      outlineColor: Cesium.Color.WHITE.withAlpha(0.8),
      outlineWidth: 2,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
    },
    label: {
      text: 'MIC 7 (Listener)',
      font: '11px JetBrains Mono, monospace',
      fillColor: CESIUM_COLORS.listener,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      pixelOffset: new Cesium.Cartesian2(0, -24),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
    },
  });

  // DOA arrow — shows where the audio says sound came from
  // Uses solid color + clampToGround + ClassificationType.BOTH to drape on 3D tiles
  // (PolylineGlowMaterialProperty is NOT supported for ground-clamped polylines)
  state.entities.doaArrow = viewer.entities.add({
    show: false,
    polyline: {
      positions: [],
      width: 4,
      material: Cesium.Color.YELLOW.withAlpha(0.8),
      clampToGround: true,
      classificationType: Cesium.ClassificationType.BOTH,
    },
  });
}

/**
 * Update listener marker position from state
 */
export function updateMarkerPositions() {
  if (state.entities.listenerPoint) {
    state.entities.listenerPoint.position =
      Cesium.Cartesian3.fromDegrees(state.listener.lon, state.listener.lat);
  }
}

/**
 * Update DOA arrow — now handled by doa-visuals.js doaLine.
 * This is a no-op kept for API compatibility.
 */
export function updateDOAArrow(azimuth, elevation, energy) {
  // DOA visualization is handled by doa-visuals.js
}

/**
 * Show a measurement line between two world positions
 */
export function showMeasurement(viewer, posA, posB) {
  const dist = Cesium.Cartesian3.distance(posA, posB);
  const midpoint = Cesium.Cartesian3.midpoint(posA, posB, new Cesium.Cartesian3());
  const propagationTime = (dist / state.speedOfSound) * 1000;

  const entity = viewer.entities.add({
    polyline: {
      positions: [posA, posB],
      width: 1,
      material: Cesium.Color.WHITE.withAlpha(0.4),
    },
  });

  const label = viewer.entities.add({
    position: midpoint,
    label: {
      text: `${dist.toFixed(2)}m / ${propagationTime.toFixed(2)}ms`,
      font: '10px JetBrains Mono, monospace',
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      pixelOffset: new Cesium.Cartesian2(0, -15),
    },
  });

  state.entities.measurements.push(entity, label);
  return { entity, label, distance: dist, time: propagationTime };
}

/**
 * Clear all measurement overlays
 */
export function clearMeasurements(viewer) {
  state.entities.measurements.forEach((e) => viewer.entities.remove(e));
  state.entities.measurements = [];
}
