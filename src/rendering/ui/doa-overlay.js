/**
 * DOA Overlay — Radar-style DOA indicator with crack/blast event markers
 *
 * Uses Formula B: compass = heading + azimuth (via ambiXToCompass)
 * Heading is time-varying — changes based on phone orientation at each timestamp.
 *
 * Shows:
 *  - Compass ring with cardinal directions (rotates with camera)
 *  - DOA arrow pointing from center in bearing direction
 *  - Crack marker (orange) and Blast marker (red) when events trigger
 *  - Energy ring, fading trail
 */

import { state } from '../../core/state.js';
import { ambiXToCompass } from '../../core/ambisonics.js';

// ─── Trail buffer ───
const MAX_TRAIL = 60;
const TRAIL_INTERVAL = 0.08;

// ─── State ───
let canvas = null;
let ctx = null;
let bearingEl = null;
let elevationEl = null;
let energyEl = null;
let overlayRoot = null;
let trail = [];
let lastTrailTime = -1;
let currentBearing = 0;
let currentElevation = 0;
let currentEnergy = 0;
let cameraHeadingRad = 0;
let isActive = false;

// Crack/Blast event markers (shown on radar for a few seconds)
let crackMarker = null;  // { bearing, fadeStart }
let blastMarker = null;

let cx, cy, radius;

export function initDOAOverlay() {
  overlayRoot = document.createElement('div');
  overlayRoot.id = 'doa-overlay';
  overlayRoot.innerHTML = `
    <div class="doa-overlay-title">DOA RADAR</div>
    <canvas id="doa-overlay-canvas" width="220" height="220"></canvas>
    <div class="doa-overlay-readout">
      <div class="doa-readout-row">
        <span class="doa-readout-label">BRG</span>
        <span class="doa-readout-value" id="doa-overlay-bearing">---.-\u00B0</span>
      </div>
      <div class="doa-readout-row">
        <span class="doa-readout-label">ELV</span>
        <span class="doa-readout-value" id="doa-overlay-elevation">---.-\u00B0</span>
      </div>
      <div class="doa-readout-row">
        <span class="doa-readout-label">NRG</span>
        <span class="doa-readout-value" id="doa-overlay-energy">--.-%</span>
      </div>
    </div>
  `;

  const hud = document.getElementById('hud');
  if (hud) hud.appendChild(overlayRoot);
  else document.body.appendChild(overlayRoot);

  canvas = document.getElementById('doa-overlay-canvas');
  ctx = canvas.getContext('2d');
  bearingEl = document.getElementById('doa-overlay-bearing');
  elevationEl = document.getElementById('doa-overlay-elevation');
  energyEl = document.getElementById('doa-overlay-energy');

  cx = canvas.width / 2;
  cy = canvas.height / 2;
  radius = (Math.min(canvas.width, canvas.height) / 2) - 16;

  if (state.viewer && state.viewer.scene) {
    state.viewer.scene.postRender.addEventListener(() => drawFrame());
  } else {
    drawFrame();
  }
}

/**
 * Update with new DOA data.
 * Uses ambiXToCompass() for correct time-varying heading conversion.
 */
export function updateDOAOverlay(azimuthRad, elevationRad, energy, time) {
  // Formula B via ambiXToCompass (heading + azimuth, time-varying)
  currentBearing = ambiXToCompass(azimuthRad, time);
  currentElevation = (elevationRad * 180) / Math.PI;
  currentEnergy = energy;
  isActive = energy > 1e-12;

  if (isActive && time - lastTrailTime > TRAIL_INTERVAL) {
    trail.push({
      bearing: currentBearing,
      energy: Math.min(1, Math.max(0, (Math.log10(energy + 1e-10) + 6) / 6)),
      time,
    });
    if (trail.length > MAX_TRAIL) trail.shift();
    lastTrailTime = time;
  }

  drawFrame();
}

/**
 * Show a crack event marker on the radar.
 */
export function showCrackMarker(compassBearing) {
  crackMarker = { bearing: compassBearing, fadeStart: performance.now() };
}

/**
 * Show a blast event marker on the radar.
 */
export function showBlastMarker(compassBearing) {
  blastMarker = { bearing: compassBearing, fadeStart: performance.now() };
}

export function hideDOAOverlay() {
  isActive = false;
  currentEnergy = 0;
  drawFrame();
}

export function clearDOAOverlayTrail() {
  trail = [];
  lastTrailTime = -1;
  crackMarker = null;
  blastMarker = null;
}

// ─── Drawing ───

function drawFrame() {
  if (!ctx) return;
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  if (state.viewer && state.viewer.camera) {
    cameraHeadingRad = state.viewer.camera.heading || 0;
  }

  const visualEnergy = isActive
    ? Math.min(1, Math.max(0, (Math.log10(currentEnergy + 1e-10) + 6) / 6))
    : 0;

  drawBackground();

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-cameraHeadingRad);
  ctx.translate(-cx, -cy);

  drawGridRings();
  drawCardinals();
  drawTrail(visualEnergy);
  drawEventMarkers();
  if (isActive) {
    drawEnergyRing(visualEnergy);
    drawDOAArrow(visualEnergy);
    drawCenterDot(visualEnergy);
  } else {
    drawCenterDot(0);
  }

  ctx.restore();
  updateReadout(visualEnergy);
}

function drawBackground() {
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 8, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(10, 14, 23, 0.88)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 8, 0, Math.PI * 2);
  ctx.strokeStyle = '#233554';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function drawGridRings() {
  for (const frac of [0.33, 0.66, 1.0]) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius * frac, 0, Math.PI * 2);
    ctx.strokeStyle = frac === 1.0 ? 'rgba(35, 53, 84, 0.8)' : 'rgba(35, 53, 84, 0.35)';
    ctx.lineWidth = frac === 1.0 ? 1.2 : 0.6;
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(35, 53, 84, 0.3)';
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(cx, cy - radius); ctx.lineTo(cx, cy + radius);
  ctx.moveTo(cx - radius, cy); ctx.lineTo(cx + radius, cy);
  ctx.stroke();

  for (let deg = 0; deg < 360; deg += 30) {
    const rad = (deg - 90) * Math.PI / 180;
    const isCardinal = deg % 90 === 0;
    const inner = isCardinal ? radius - 8 : radius - 5;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(rad) * inner, cy + Math.sin(rad) * inner);
    ctx.lineTo(cx + Math.cos(rad) * radius, cy + Math.sin(rad) * radius);
    ctx.strokeStyle = isCardinal ? '#8892b0' : 'rgba(136, 146, 176, 0.4)';
    ctx.lineWidth = isCardinal ? 1.5 : 0.8;
    ctx.stroke();
  }
}

function drawCardinals() {
  ctx.font = 'bold 11px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const labels = [
    { text: 'N', deg: 0, color: '#ff3d71' },
    { text: 'E', deg: 90, color: '#8892b0' },
    { text: 'S', deg: 180, color: '#8892b0' },
    { text: 'W', deg: 270, color: '#8892b0' },
  ];
  for (const { text, deg, color } of labels) {
    const rad = (deg - 90) * Math.PI / 180;
    const dist = radius + 14;
    ctx.save();
    ctx.translate(cx + Math.cos(rad) * dist, cy + Math.sin(rad) * dist);
    ctx.rotate(cameraHeadingRad);
    ctx.fillStyle = color;
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }
}

function drawTrail(visualEnergy) {
  if (trail.length < 2) return;
  const now = trail[trail.length - 1].time;
  for (const pt of trail) {
    const age = now - pt.time;
    const fade = Math.max(0, 1 - age / (MAX_TRAIL * TRAIL_INTERVAL));
    const bearingRad = (pt.bearing - 90) * Math.PI / 180;
    const dist = (0.25 + pt.energy * 0.45) * radius;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(bearingRad) * dist, cy + Math.sin(bearingRad) * dist,
            1.5 + pt.energy * 2, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 154, 31, ${fade * 0.5 * pt.energy})`;
    ctx.fill();
  }
}

function drawEventMarkers() {
  const now = performance.now();
  const MARKER_DURATION = 3000; // 3 seconds visible

  // Crack marker (orange)
  if (crackMarker) {
    const elapsed = now - crackMarker.fadeStart;
    if (elapsed < MARKER_DURATION) {
      const fade = 1 - elapsed / MARKER_DURATION;
      drawEventDot(crackMarker.bearing, `rgba(255, 165, 0, ${fade})`, 'CRACK', fade);
    } else {
      crackMarker = null;
    }
  }

  // Blast marker (red)
  if (blastMarker) {
    const elapsed = now - blastMarker.fadeStart;
    if (elapsed < MARKER_DURATION) {
      const fade = 1 - elapsed / MARKER_DURATION;
      drawEventDot(blastMarker.bearing, `rgba(255, 0, 0, ${fade})`, 'BLAST', fade);
    } else {
      blastMarker = null;
    }
  }
}

function drawEventDot(bearing, color, label, fade) {
  const bearingRad = (bearing - 90) * Math.PI / 180;
  const dist = radius * 0.75;
  const x = cx + Math.cos(bearingRad) * dist;
  const y = cy + Math.sin(bearingRad) * dist;

  // Pulsing ring
  const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 150);
  ctx.beginPath();
  ctx.arc(x, y, 8 + pulse * 4, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Center dot
  ctx.beginPath();
  ctx.arc(x, y, 4, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  // Label
  ctx.save();
  ctx.translate(x, y - 14);
  ctx.rotate(cameraHeadingRad); // counter-rotate for readability
  ctx.font = 'bold 9px monospace';
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.fillText(label, 0, 0);
  ctx.restore();
}

function drawEnergyRing(visualEnergy) {
  if (visualEnergy < 0.01) return;
  const pulseRadius = radius * (0.2 + visualEnergy * 0.15);
  const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 250);
  ctx.beginPath();
  ctx.arc(cx, cy, pulseRadius, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(100, 255, 218, ${(0.15 + visualEnergy * 0.35) * (0.7 + pulse * 0.3)})`;
  ctx.lineWidth = 1.5 + visualEnergy * 2;
  ctx.stroke();
}

function drawDOAArrow(visualEnergy) {
  const bearingRad = (currentBearing - 90) * Math.PI / 180;
  const arrowLength = radius * 0.85;
  const tipX = cx + Math.cos(bearingRad) * arrowLength;
  const tipY = cy + Math.sin(bearingRad) * arrowLength;

  const gradient = ctx.createLinearGradient(cx, cy, tipX, tipY);
  gradient.addColorStop(0, 'rgba(0, 229, 255, 0.05)');
  gradient.addColorStop(0.4, `rgba(0, 229, 255, ${0.3 + visualEnergy * 0.5})`);
  gradient.addColorStop(1, `rgba(0, 229, 255, ${0.6 + visualEnergy * 0.4})`);

  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(tipX, tipY);
  ctx.strokeStyle = gradient;
  ctx.lineWidth = 2 + visualEnergy * 1.5;
  ctx.stroke();

  const headLen = 10 + visualEnergy * 4;
  const headAngle = 0.4;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(tipX - headLen * Math.cos(bearingRad - headAngle),
             tipY - headLen * Math.sin(bearingRad - headAngle));
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(tipX - headLen * Math.cos(bearingRad + headAngle),
             tipY - headLen * Math.sin(bearingRad + headAngle));
  ctx.strokeStyle = `rgba(0, 229, 255, ${0.7 + visualEnergy * 0.3})`;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(tipX, tipY, 3 + visualEnergy * 2, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(0, 229, 255, ${0.6 + visualEnergy * 0.4})`;
  ctx.fill();
}

function drawCenterDot(visualEnergy) {
  const glow = isActive ? 0.3 + visualEnergy * 0.5 : 0.2;
  ctx.beginPath();
  ctx.arc(cx, cy, 3, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(100, 255, 218, ${glow})`;
  ctx.fill();
}

function updateReadout(visualEnergy) {
  if (!bearingEl) return;
  if (isActive) {
    bearingEl.textContent = currentBearing.toFixed(1) + '\u00B0';
    bearingEl.style.color = '#00e5ff';
    elevationEl.textContent = currentElevation.toFixed(1) + '\u00B0';
    elevationEl.style.color = '#ccd6f6';
    energyEl.textContent = (visualEnergy * 100).toFixed(1) + '%';
    energyEl.style.color = visualEnergy > 0.5 ? '#64ffda' : '#8892b0';
  } else {
    bearingEl.textContent = '---.-\u00B0';
    bearingEl.style.color = '#233554';
    elevationEl.textContent = '---.-\u00B0';
    elevationEl.style.color = '#233554';
    energyEl.textContent = '--.-%';
    energyEl.style.color = '#233554';
  }
}
