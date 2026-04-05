/**
 * DOA Map Visuals — Screen-space bearing line + entity-based trail dots
 *
 * The bearing line is drawn as a 2D canvas overlay on top of the Cesium viewer
 * using SceneTransforms.wgs84ToWindowCoordinates. This bypasses all entity
 * rendering issues with Google 3D Tiles.
 *
 * Trail dots remain as pre-created Cesium point entities (ring buffer).
 * Band indicators flash during transient events.
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
const BEARING_LEN_MIN = 10;
const BEARING_LEN_MAX = 22;
const BEARING_WIDTH_MIN = 2;
const BEARING_WIDTH_MAX = 6;

// ─── Trail config ───
const TRAIL_DIST_MIN = 3;
const TRAIL_DIST_MAX = 14;
const MAX_TRAIL = 300;
const TRAIL_INTERVAL = 0.08;

// ─── State ───
let _viewer = null;
let _sceneHeight = 0; // WGS84 ellipsoid height at listener, sampled once
let bearingCanvas = null;
let bearingCtx = null;
let trailDots = [];
let trailIdx = 0;
let trailInited = false;
let lastTrailTime = -1;
let prevEnergy = 0;
let currentBearing = { dirE: 0, dirN: 0, compass: 0, ve: 0, active: false };

function groundPos(eastM, northM) {
  return Cesium.Cartesian3.fromDegrees(
    state.listener.lon + eastM * LON_DEG_PER_METER,
    state.listener.lat + northM * LAT_DEG_PER_METER,
    _sceneHeight
  );
}

function listenerCartesian() {
  return Cesium.Cartesian3.fromDegrees(state.listener.lon, state.listener.lat, _sceneHeight);
}

function energyColor(e) {
  if (e < 0.4) {
    const t = e / 0.4;
    return `rgba(255, 255, ${50 - t * 25}, ${0.3 + t * 0.4})`;
  } else if (e < 0.7) {
    const t = (e - 0.4) / 0.3;
    return `rgba(255, ${255 - t * 90}, ${25 - t * 25}, ${0.6 + t * 0.2})`;
  } else {
    const t = (e - 0.7) / 0.3;
    return `rgba(255, ${165 - t * 130}, 0, ${0.8 + t * 0.2})`;
  }
}

function energyColorCesium(e) {
  if (e < 0.4) {
    const t = e / 0.4;
    return new Cesium.Color(1, 1, 0.2 - t * 0.1, 0.3 + t * 0.3);
  } else if (e < 0.7) {
    const t = (e - 0.4) / 0.3;
    return new Cesium.Color(1, 1 - t * 0.35, 0.1 - t * 0.1, 0.5 + t * 0.2);
  } else {
    const t = (e - 0.7) / 0.3;
    return new Cesium.Color(1, 0.65 - t * 0.5, 0, 0.7 + t * 0.2);
  }
}

function trailColor(e) {
  const c = energyColorCesium(e);
  return c.withAlpha(c.alpha * 0.6);
}

// ─── Public API ───

export function initDOAVisuals(viewer) {
  _viewer = viewer;

  // Sample the scene height at listener position for worldToWindowCoordinates
  try {
    const carto = Cesium.Cartographic.fromDegrees(state.listener.lon, state.listener.lat);
    const h = viewer.scene.sampleHeight(carto);
    _sceneHeight = (h !== undefined && h > 0) ? h : 1363;
  } catch (e) {
    _sceneHeight = 1363;
  }
  console.log('[DOA-VIS] Scene height: ' + _sceneHeight.toFixed(1) + 'm');

  const listenerPos = listenerCartesian();

  // Create transparent canvas overlay for the bearing line
  // Appended to body (not cesiumContainer — Cesium manages that div's children)
  bearingCanvas = document.createElement('canvas');
  bearingCanvas.id = 'doa-bearing-canvas';
  bearingCanvas.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:1000;';
  document.body.appendChild(bearingCanvas);
  bearingCtx = bearingCanvas.getContext('2d');

  // Match canvas resolution to viewport
  function resizeCanvas() {
    bearingCanvas.width = window.innerWidth;
    bearingCanvas.height = window.innerHeight;
  }
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  // Draw bearing on every Cesium render frame
  viewer.scene.postRender.addEventListener(() => {
    drawBearingLine();
  });

  // Pre-create trail ring buffer
  for (let i = 0; i < MAX_TRAIL; i++) {
    trailDots.push(viewer.entities.add({
      show: false,
      position: listenerPos,
      point: {
        pixelSize: 3,
        color: Cesium.Color.YELLOW.withAlpha(0.3),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
    }));
  }
  trailInited = true;

  console.log('[DOA-VIS] Initialized — canvas bearing line + ' + MAX_TRAIL + ' trail dots');
}

export function setCrackBlastEvents() {}

export function updateDOAVisuals(viewer, azimuth, elevation, energy, time, bands) {
  const ve = Math.min(1, Math.max(0, (Math.log10(energy + 1e-10) + 6) / 6));
  const { east: dirE, north: dirN, compass } = ambiXToENU(azimuth, time);

  const energyJump = ve - prevEnergy;
  prevEnergy = ve;

  // Store current bearing state for the canvas renderer
  currentBearing = { dirE, dirN, compass, ve: Math.max(0.05, ve), active: state.showDOA, bands };

  // ─── Trail dots (ring buffer) ───
  if (state.showDOA && trailInited && time - lastTrailTime > TRAIL_INTERVAL) {
    lastTrailTime = time;
    const trailDist = TRAIL_DIST_MIN + ve * (TRAIL_DIST_MAX - TRAIL_DIST_MIN);
    const dotSize = Math.max(2, 3 + ve * 6);
    const dot = trailDots[trailIdx];
    dot.position = groundPos(dirE * trailDist, dirN * trailDist);
    dot.point.pixelSize = dotSize;
    dot.point.color = trailColor(ve);
    dot.show = true;
    trailIdx = (trailIdx + 1) % MAX_TRAIL;
  }
}

/**
 * Draw bearing line on the 2D canvas overlay.
 * Called on every Cesium postRender — converts world positions to screen coords.
 */
function drawBearingLine() {
  if (!bearingCtx || !_viewer) return;
  const w = bearingCanvas.width, h = bearingCanvas.height;
  bearingCtx.clearRect(0, 0, w, h);

  if (!currentBearing.active) return;

  const { dirE, dirN, compass, ve, bands } = currentBearing;
  const lineLen = BEARING_LEN_MIN + ve * (BEARING_LEN_MAX - BEARING_LEN_MIN);
  const lineWidth = BEARING_WIDTH_MIN + ve * (BEARING_WIDTH_MAX - BEARING_WIDTH_MIN);

  // Convert world positions (at scene height) to screen coordinates
  const startWorld = listenerCartesian();
  const tipWorld = groundPos(dirE * lineLen, dirN * lineLen);
  const startScreen = Cesium.SceneTransforms.worldToWindowCoordinates(_viewer.scene, startWorld);
  const endScreen = Cesium.SceneTransforms.worldToWindowCoordinates(_viewer.scene, tipWorld);

  if (!startScreen || !endScreen) return;

  // ─── Primary bearing line ───
  const color = energyColor(ve);

  // Black outline
  bearingCtx.beginPath();
  bearingCtx.moveTo(startScreen.x, startScreen.y);
  bearingCtx.lineTo(endScreen.x, endScreen.y);
  bearingCtx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
  bearingCtx.lineWidth = lineWidth + 3;
  bearingCtx.lineCap = 'round';
  bearingCtx.stroke();

  // Colored fill
  bearingCtx.beginPath();
  bearingCtx.moveTo(startScreen.x, startScreen.y);
  bearingCtx.lineTo(endScreen.x, endScreen.y);
  bearingCtx.strokeStyle = color;
  bearingCtx.lineWidth = lineWidth;
  bearingCtx.lineCap = 'round';
  bearingCtx.stroke();

  // Arrowhead at tip
  const dx = endScreen.x - startScreen.x;
  const dy = endScreen.y - startScreen.y;
  const angle = Math.atan2(dy, dx);
  const headLen = 10 + ve * 6;
  bearingCtx.beginPath();
  bearingCtx.moveTo(endScreen.x, endScreen.y);
  bearingCtx.lineTo(endScreen.x - headLen * Math.cos(angle - 0.4), endScreen.y - headLen * Math.sin(angle - 0.4));
  bearingCtx.moveTo(endScreen.x, endScreen.y);
  bearingCtx.lineTo(endScreen.x - headLen * Math.cos(angle + 0.4), endScreen.y - headLen * Math.sin(angle + 0.4));
  bearingCtx.strokeStyle = color;
  bearingCtx.lineWidth = Math.max(2, lineWidth * 0.7);
  bearingCtx.stroke();

  // Bearing label
  bearingCtx.font = 'bold 13px JetBrains Mono, monospace';
  bearingCtx.textAlign = 'center';
  const labelX = endScreen.x + Math.cos(angle) * 16;
  const labelY = endScreen.y + Math.sin(angle) * 16;
  bearingCtx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
  bearingCtx.lineWidth = 4;
  bearingCtx.strokeText(compass.toFixed(0) + '\u00B0', labelX, labelY);
  bearingCtx.fillStyle = color;
  bearingCtx.fillText(compass.toFixed(0) + '\u00B0', labelX, labelY);

  // ─── Frequency-dependent band bearing lines (during transients) ───
  if (bands) {
    // Compute total band energy for proportional width scaling
    const totalBandEnergy =
      (bands.low ? bands.low.energy : 0) +
      (bands.mid ? bands.mid.energy : 0) +
      (bands.high ? bands.high.energy : 0);

    // LOW (80-500Hz): thick blue line
    drawBandBearingLine(bands.low, {
      color: 'rgba(40, 120, 255, 0.85)',
      label: 'LOW 80-500Hz',
      baseWidth: 5,
      totalBandEnergy,
      startWorld,
    });
    // MID (500-3kHz): medium green line
    drawBandBearingLine(bands.mid, {
      color: 'rgba(40, 220, 80, 0.85)',
      label: 'MID 0.5-3kHz',
      baseWidth: 3.5,
      totalBandEnergy,
      startWorld,
    });
    // HIGH (3-10kHz): thin red line
    drawBandBearingLine(bands.high, {
      color: 'rgba(255, 60, 60, 0.85)',
      label: 'HIGH 3-10kHz',
      baseWidth: 2,
      totalBandEnergy,
      startWorld,
    });

    // Draw legend when band data is visible
    drawBandLegend(bands);
  }
}

/**
 * Draw a single frequency-band bearing line with energy-proportional width.
 */
function drawBandBearingLine(band, opts) {
  if (!band || band.energy < 1e-6) return;
  const bandVe = Math.min(1, Math.max(0, (Math.log10(band.energy + 1e-10) + 6) / 6));
  if (bandVe < 0.10) return;

  const { color, label, baseWidth, totalBandEnergy, startWorld } = opts;

  // Width is proportional to this band's share of total energy
  const energyFrac = totalBandEnergy > 1e-10 ? band.energy / totalBandEnergy : 0.33;
  const lineWidth = baseWidth * (0.5 + energyFrac * 1.5);

  const { east: bDirE, north: bDirN, compass: bCompass } = ambiXToENU(band.azimuth, 0);
  const lineLen = 8 + bandVe * 12;
  const endWorld = groundPos(bDirE * lineLen, bDirN * lineLen);

  const startScreen = Cesium.SceneTransforms.worldToWindowCoordinates(_viewer.scene, startWorld);
  const endScreen = Cesium.SceneTransforms.worldToWindowCoordinates(_viewer.scene, endWorld);
  if (!startScreen || !endScreen) return;

  // Black outline for contrast
  bearingCtx.setLineDash([]);
  bearingCtx.beginPath();
  bearingCtx.moveTo(startScreen.x, startScreen.y);
  bearingCtx.lineTo(endScreen.x, endScreen.y);
  bearingCtx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
  bearingCtx.lineWidth = lineWidth + 2;
  bearingCtx.lineCap = 'round';
  bearingCtx.stroke();

  // Colored bearing line (solid)
  bearingCtx.beginPath();
  bearingCtx.moveTo(startScreen.x, startScreen.y);
  bearingCtx.lineTo(endScreen.x, endScreen.y);
  bearingCtx.strokeStyle = color;
  bearingCtx.lineWidth = lineWidth;
  bearingCtx.lineCap = 'round';
  bearingCtx.stroke();

  // Bearing label at tip
  bearingCtx.font = 'bold 10px JetBrains Mono, monospace';
  bearingCtx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
  bearingCtx.lineWidth = 3;
  bearingCtx.strokeText(`${bCompass.toFixed(0)}\u00B0`, endScreen.x + 8, endScreen.y - 4);
  bearingCtx.fillStyle = color;
  bearingCtx.fillText(`${bCompass.toFixed(0)}\u00B0`, endScreen.x + 8, endScreen.y - 4);
}

/**
 * Draw a corner legend showing which color maps to which frequency band.
 * Only shown when band data is present and at least one band is active.
 */
function drawBandLegend(bands) {
  const activeBands = [];
  if (bands.low && bands.low.energy > 1e-6) activeBands.push({ label: 'LOW  80-500Hz', color: 'rgba(40, 120, 255, 0.9)' });
  if (bands.mid && bands.mid.energy > 1e-6) activeBands.push({ label: 'MID  0.5-3kHz', color: 'rgba(40, 220, 80, 0.9)' });
  if (bands.high && bands.high.energy > 1e-6) activeBands.push({ label: 'HIGH 3-10kHz', color: 'rgba(255, 60, 60, 0.9)' });
  if (activeBands.length === 0) return;

  const x = 14;
  const y = 60;
  const rowH = 16;
  const pad = 6;
  const boxW = 140;
  const boxH = pad * 2 + activeBands.length * rowH + 14;

  // Background box
  bearingCtx.fillStyle = 'rgba(10, 14, 23, 0.85)';
  bearingCtx.strokeStyle = 'rgba(35, 53, 84, 0.8)';
  bearingCtx.lineWidth = 1;
  bearingCtx.beginPath();
  bearingCtx.roundRect(x, y, boxW, boxH, 4);
  bearingCtx.fill();
  bearingCtx.stroke();

  // Title
  bearingCtx.font = 'bold 8px JetBrains Mono, monospace';
  bearingCtx.fillStyle = 'rgba(204, 214, 246, 0.8)';
  bearingCtx.fillText('FREQ BANDS', x + pad, y + pad + 8);

  // Band entries
  bearingCtx.font = '9px JetBrains Mono, monospace';
  for (let i = 0; i < activeBands.length; i++) {
    const ey = y + pad + 16 + i * rowH;
    // Color swatch
    bearingCtx.fillStyle = activeBands[i].color;
    bearingCtx.fillRect(x + pad, ey, 10, 10);
    // Label
    bearingCtx.fillStyle = 'rgba(136, 146, 176, 0.9)';
    bearingCtx.fillText(activeBands[i].label, x + pad + 16, ey + 9);
  }
}

// ─── Visibility ───

export function hideAll() {
  currentBearing.active = false;
}

export function clearDOATrail(viewer) {
  trailDots.forEach(d => d.show = false);
  trailIdx = 0;
  lastTrailTime = -1;
  prevEnergy = 0;
  currentBearing.active = false;
}
