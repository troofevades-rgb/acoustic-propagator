/**
 * DOA map visuals — bearing line + trail on the 3D tile surface
 *
 * Creates fresh ground-clamped entities each update (throttled to 5/sec).
 * Solid color + classificationType:BOTH proven to work on Google 3D Tiles.
 */

const Cesium = window.Cesium;
import { state } from '../core/state.js';

// ─── Device-to-World Calibration ───
const DEVICE_HEADING_DEG = 241.3;
const HEADING_OFFSET_RAD = (90 - DEVICE_HEADING_DEG) * Math.PI / 180;

// ─── Geographic helpers ───
const LAT_DEG_PER_METER = 1 / 111320;
const LON_DEG_PER_METER = 1 / (111320 * Math.cos(40.277 * Math.PI / 180));

let bearingLineEntity = null;
let bearingLabelEntity = null;
let lastUpdateTime = -1;
let doaTrailPoints = [];
const MAX_TRAIL = 300;
let _viewer = null;

function degPos(eastM, northM) {
  return Cesium.Cartesian3.fromDegrees(
    state.listener.lon + eastM * LON_DEG_PER_METER,
    state.listener.lat + northM * LAT_DEG_PER_METER
  );
}

export function initDOAVisuals(viewer) {
  _viewer = viewer;
}

export function updateDOAVisuals(viewer, azimuth, elevation, energy, time) {
  if (energy < 1e-12) {
    hideAll();
    return;
  }

  const visualEnergy = Math.min(1, Math.max(0, (Math.log10(energy + 1e-10) + 6) / 6));
  const worldAzimuth = azimuth + HEADING_OFFSET_RAD;
  const dirE = Math.cos(worldAzimuth);
  const dirN = Math.sin(worldAzimuth);
  const compassBearing = ((DEVICE_HEADING_DEG - (azimuth * 180 / Math.PI)) % 360 + 360) % 360;

  // ─── Bearing line: create fresh every ~200ms ───
  if (state.showDOA && time - lastUpdateTime > 0.2) {
    lastUpdateTime = time;

    if (bearingLineEntity) {
      viewer.entities.remove(bearingLineEntity);
      bearingLineEntity = null;
    }
    if (bearingLabelEntity) {
      viewer.entities.remove(bearingLabelEntity);
      bearingLabelEntity = null;
    }

    const lineLength = 40;
    const positions = [];
    for (let i = 0; i <= 20; i++) {
      const dist = (i / 20) * lineLength;
      positions.push(degPos(dirE * dist, dirN * dist));
    }

    bearingLineEntity = viewer.entities.add({
      polyline: {
        positions: positions,
        width: 5,
        material: Cesium.Color.YELLOW.withAlpha(0.9),
        clampToGround: true,
        classificationType: Cesium.ClassificationType.BOTH,
      },
    });

    bearingLabelEntity = viewer.entities.add({
      position: degPos(dirE * lineLength, dirN * lineLength),
      label: {
        text: `${compassBearing.toFixed(0)}°`,
        font: 'bold 13px JetBrains Mono, monospace',
        fillColor: Cesium.Color.YELLOW,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 4,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -18),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
    });
  }

  // ─── Trail dots ───
  if (state.showDOA) {
    const lastTime = doaTrailPoints.length > 0 ? doaTrailPoints[doaTrailPoints.length - 1].time : -1;
    if (time - lastTime > 0.1) {
      const trailDist = 5 + visualEnergy * 12;
      const entity = viewer.entities.add({
        position: degPos(dirE * trailDist, dirN * trailDist),
        point: {
          pixelSize: Math.max(4, visualEnergy * 10),
          color: Cesium.Color.YELLOW.withAlpha(Math.max(0.3, visualEnergy * 0.6)),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
      });
      doaTrailPoints.push({ entity, time });

      while (doaTrailPoints.length > MAX_TRAIL) {
        const old = doaTrailPoints.shift();
        viewer.entities.remove(old.entity);
      }
    }
  }
}

export function hideAll() {
  if (bearingLineEntity && _viewer) {
    _viewer.entities.remove(bearingLineEntity);
    bearingLineEntity = null;
  }
  if (bearingLabelEntity && _viewer) {
    _viewer.entities.remove(bearingLabelEntity);
    bearingLabelEntity = null;
  }
}

export function clearDOATrail(viewer) {
  doaTrailPoints.forEach(p => {
    try { viewer.entities.remove(p.entity); } catch (e) {}
  });
  doaTrailPoints = [];
  lastUpdateTime = -1;
  hideAll();
}
