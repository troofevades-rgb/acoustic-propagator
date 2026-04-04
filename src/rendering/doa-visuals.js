/**
 * DOA Map Visuals — Energy-driven bearing indicator, trail, wavefront arcs
 *
 * Bearing:     tight row of pre-created dots (fast updates, proven to render)
 * Trail:       accumulating dots showing DOA history, colored by energy
 * Arcs:        dot-based expanding arcs on energy spikes
 *
 * Color: yellow (ambient) → orange (speech) → red (blast)
 */

const Cesium = window.Cesium;
import { state } from '../core/state.js';
import { ambiXToENU } from '../core/ambisonics.js';

// ─── Geographic helpers ───
const LAT_DEG_PER_METER = 1 / 111320;
const LON_DEG_PER_METER = 1 / (111320 * Math.cos(40.277 * Math.PI / 180));

// ─── Bearing config ───
const BEARING_DOTS = 8;
const BEARING_LEN_MIN = 10;
const BEARING_LEN_MAX = 20;
const BEARING_SIZE_BASE = 12;   // px at base (large, distinct)
const BEARING_SIZE_TIP = 5;     // px at tip

// ─── Trail config ───
const TRAIL_DIST_MIN = 3;
const TRAIL_DIST_MAX = 14;
const MAX_TRAIL = 400;
const TRAIL_INTERVAL = 0.08;

// ─── Arc config ───
const ARC_ANGULAR_WIDTH = 50;
const ARC_MAX_RADIUS = 35;
const ARC_LIFETIME = 1.2;
const MAX_ARCS = 12;
const ARC_ENERGY_THRESHOLD = 0.35;
const ARC_COOLDOWN = 0.15;

// ─── State ───
let _viewer = null;
let bearingDots = [];
let bearingLabelEntity = null;
let doaTrailPoints = [];
let lastTrailTime = -1;
let lastUpdateTime = -1;
let lastArcTime = -1;
let activeArcs = [];
let prevEnergy = 0;

function groundPos(eastM, northM) {
  return Cesium.Cartesian3.fromDegrees(
    state.listener.lon + eastM * LON_DEG_PER_METER,
    state.listener.lat + northM * LAT_DEG_PER_METER
  );
}

function energyColor(e) {
  if (e < 0.4) {
    const t = e / 0.4;
    return new Cesium.Color(1.0, 1.0, 0.2 - t * 0.1, 0.3 + t * 0.3);
  } else if (e < 0.7) {
    const t = (e - 0.4) / 0.3;
    return new Cesium.Color(1.0, 1.0 - t * 0.35, 0.1 - t * 0.1, 0.5 + t * 0.2);
  } else {
    const t = (e - 0.7) / 0.3;
    return new Cesium.Color(1.0, 0.65 - t * 0.5, 0.0, 0.7 + t * 0.2);
  }
}

function trailColor(e) {
  const c = energyColor(e);
  return c.withAlpha(c.alpha * 0.6);
}

// ─── Public API ───

export function initDOAVisuals(viewer) {
  _viewer = viewer;

  // Pre-create bearing dots — outlined for visibility against tiles
  for (let i = 0; i < BEARING_DOTS; i++) {
    bearingDots.push(viewer.entities.add({
      show: false,
      position: Cesium.Cartesian3.fromDegrees(state.listener.lon, state.listener.lat),
      point: {
        pixelSize: BEARING_SIZE_BASE,
        color: Cesium.Color.YELLOW,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
    }));
  }

  bearingLabelEntity = viewer.entities.add({
    show: false,
    position: Cesium.Cartesian3.fromDegrees(state.listener.lon, state.listener.lat),
    label: {
      text: '0\u00B0',
      font: 'bold 13px JetBrains Mono, monospace',
      fillColor: Cesium.Color.YELLOW,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 4,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      pixelOffset: new Cesium.Cartesian2(0, -14),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
    },
  });

  console.log('[DOA-VIS] Initialized — ' + BEARING_DOTS + ' bearing dots pre-created');
}

export function setCrackBlastEvents() {}

export function updateDOAVisuals(viewer, azimuth, elevation, energy, time) {
  const ve = Math.min(1, Math.max(0, (Math.log10(energy + 1e-10) + 6) / 6));
  const { east: dirE, north: dirN, compass: compassBearing } = ambiXToENU(azimuth, time);

  const energyJump = ve - prevEnergy;
  const isTransient = energyJump > 0.15;
  prevEnergy = ve;

  // Even at very low energy, keep bearing visible (just dim/small)
  const lineLen = BEARING_LEN_MIN + ve * (BEARING_LEN_MAX - BEARING_LEN_MIN);
  const color = energyColor(Math.max(0.05, ve)); // never fully transparent

  // ─── Bearing dots: update at ~20fps (smooth but not overwhelming Cesium) ───
  if (state.showDOA && time - lastUpdateTime > 0.05) {
    for (let i = 0; i < BEARING_DOTS; i++) {
      const frac = (i + 1) / BEARING_DOTS;
      const dist = frac * lineLen;
      bearingDots[i].position = groundPos(dirE * dist, dirN * dist);

      const size = BEARING_SIZE_BASE - frac * (BEARING_SIZE_BASE - BEARING_SIZE_TIP);
      bearingDots[i].point.pixelSize = isTransient ? size * 1.5 : size;
      bearingDots[i].point.color = color;
      bearingDots[i].show = true;
    }

    bearingLabelEntity.position = groundPos(dirE * lineLen, dirN * lineLen);
    bearingLabelEntity.label.text = compassBearing.toFixed(0) + '\u00B0';
    bearingLabelEntity.label.fillColor = color;
    bearingLabelEntity.show = true;

    lastUpdateTime = time;
  }

  // ─── Wavefront arcs (dot-based) ───
  if (state.showDOA && ve > ARC_ENERGY_THRESHOLD && time - lastArcTime > ARC_COOLDOWN) {
    lastArcTime = time;
    const arcSize = isTransient ? 6 : Math.max(3, ve * 5);
    spawnArc(viewer, compassBearing, time, color, arcSize,
      isTransient ? ARC_ANGULAR_WIDTH + 20 : ARC_ANGULAR_WIDTH);
  }
  updateArcs(viewer, time);

  // ─── Trail dots ───
  if (state.showDOA && time - lastTrailTime > TRAIL_INTERVAL) {
    lastTrailTime = time;
    const trailDist = TRAIL_DIST_MIN + ve * (TRAIL_DIST_MAX - TRAIL_DIST_MIN);
    const dotSize = Math.max(2, 3 + ve * 6);
    const entity = viewer.entities.add({
      position: groundPos(dirE * trailDist, dirN * trailDist),
      point: {
        pixelSize: dotSize,
        color: trailColor(ve),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
    });
    doaTrailPoints.push({ entity, time });
    while (doaTrailPoints.length > MAX_TRAIL) {
      const old = doaTrailPoints.shift();
      try { viewer.entities.remove(old.entity); } catch (e) {}
    }
  }
}

// ─── Arcs ───

function spawnArc(viewer, compassBearing, birthTime, color, dotSize, angularWidth) {
  const dotCount = 8;
  const entities = [];
  const halfWidth = angularWidth / 2;
  for (let i = 0; i <= dotCount; i++) {
    const angleDeg = compassBearing - halfWidth + (angularWidth * i / dotCount);
    const enuAngle = (90 - angleDeg) * Math.PI / 180;
    entities.push(viewer.entities.add({
      position: groundPos(Math.cos(enuAngle) * 2, Math.sin(enuAngle) * 2),
      point: {
        pixelSize: dotSize,
        color: color,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
    }));
  }
  activeArcs.push({ entities, birthTime, compassBearing, angularWidth, color });
  while (activeArcs.length > MAX_ARCS) {
    const old = activeArcs.shift();
    old.entities.forEach(e => { try { viewer.entities.remove(e); } catch (ex) {} });
  }
}

function updateArcs(viewer, currentTime) {
  const toRemove = [];
  for (const arc of activeArcs) {
    const elapsed = currentTime - arc.birthTime;
    const radiusM = elapsed * 349 * 0.12;
    if (radiusM > ARC_MAX_RADIUS || elapsed > ARC_LIFETIME) {
      toRemove.push(arc);
      continue;
    }
    const fade = Math.max(0, 1 - elapsed / ARC_LIFETIME);
    const halfWidth = arc.angularWidth / 2;
    const r = Math.max(1, radiusM);
    for (let i = 0; i < arc.entities.length; i++) {
      const angleDeg = arc.compassBearing - halfWidth + (arc.angularWidth * i / (arc.entities.length - 1));
      const enuAngle = (90 - angleDeg) * Math.PI / 180;
      arc.entities[i].position = groundPos(Math.cos(enuAngle) * r, Math.sin(enuAngle) * r);
      arc.entities[i].point.color = arc.color.withAlpha(fade * 0.7);
    }
  }
  for (const arc of toRemove) {
    arc.entities.forEach(e => { try { viewer.entities.remove(e); } catch (ex) {} });
    const idx = activeArcs.indexOf(arc);
    if (idx >= 0) activeArcs.splice(idx, 1);
  }
}

// ─── Visibility ───

export function hideAll() {
  bearingDots.forEach(d => d.show = false);
  if (bearingLabelEntity) bearingLabelEntity.show = false;
}

export function clearDOATrail(viewer) {
  doaTrailPoints.forEach(p => {
    try { viewer.entities.remove(p.entity); } catch (e) {}
  });
  doaTrailPoints = [];
  lastTrailTime = -1;
  lastUpdateTime = -1;
  lastArcTime = -1;
  prevEnergy = 0;

  activeArcs.forEach(arc => {
    arc.entities.forEach(e => { try { viewer.entities.remove(e); } catch (ex) {} });
  });
  activeArcs = [];

  hideAll();
}
