/**
 * DOA Overlay — Pure HTML/CSS/Canvas radar-style DOA indicator
 *
 * Renders direction-of-arrival as a 2D overlay on top of the Cesium viewer.
 * No CesiumJS entities, no height/clamping issues. Just screen-space 2D.
 *
 * Draws:
 *  - Compass ring with cardinal directions
 *  - DOA arrow pointing from center outward in the bearing direction
 *  - Energy ring that pulses with signal strength
 *  - Bearing readout (numeric)
 *  - Fading trail of recent DOA headings
 *
 * The radar rotates with the Cesium camera heading so that North on the
 * radar always matches North on the map.
 */

import { state } from '../core/state.js';

// ─── Device-to-World Calibration (must match doa-visuals.js) ───
const DEVICE_HEADING_DEG = 241.3;

// ─── Trail buffer ───
const MAX_TRAIL = 60;
const TRAIL_INTERVAL = 0.08; // seconds between trail samples

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
let cameraHeadingRad = 0; // Cesium camera heading in radians (0 = north, increases clockwise)
let isActive = false;

// ─── Cached dimensions ───
let cx, cy, radius;

/**
 * Build the overlay DOM and insert it into the page.
 * Call once after DOMContentLoaded.
 */
export function initDOAOverlay() {
  // Container
  overlayRoot = document.createElement('div');
  overlayRoot.id = 'doa-overlay';
  overlayRoot.innerHTML = `
    <div class="doa-overlay-title">DOA RADAR</div>
    <canvas id="doa-overlay-canvas" width="220" height="220"></canvas>
    <div class="doa-overlay-readout">
      <div class="doa-readout-row">
        <span class="doa-readout-label">BRG</span>
        <span class="doa-readout-value" id="doa-overlay-bearing">---.-°</span>
      </div>
      <div class="doa-readout-row">
        <span class="doa-readout-label">ELV</span>
        <span class="doa-readout-value" id="doa-overlay-elevation">---.-°</span>
      </div>
      <div class="doa-readout-row">
        <span class="doa-readout-label">NRG</span>
        <span class="doa-readout-value" id="doa-overlay-energy">--.-%</span>
      </div>
    </div>
  `;

  // Insert into HUD so it inherits pointer-events behavior
  const hud = document.getElementById('hud');
  if (hud) {
    hud.appendChild(overlayRoot);
  } else {
    document.body.appendChild(overlayRoot);
  }

  canvas = document.getElementById('doa-overlay-canvas');
  ctx = canvas.getContext('2d');
  bearingEl = document.getElementById('doa-overlay-bearing');
  elevationEl = document.getElementById('doa-overlay-elevation');
  energyEl = document.getElementById('doa-overlay-energy');

  // Pre-compute layout
  cx = canvas.width / 2;
  cy = canvas.height / 2;
  radius = (Math.min(canvas.width, canvas.height) / 2) - 16;

  // Keep the radar synced with the Cesium camera heading on every render
  // frame, just like the compass widget does.  Without this, the radar only
  // redraws when DOA audio data arrives and freezes when audio is paused or
  // the user rotates the map without playing audio.
  if (state.viewer && state.viewer.scene) {
    state.viewer.scene.postRender.addEventListener(() => {
      drawFrame();
    });
  } else {
    // Fallback: initial static draw if viewer is not ready yet
    drawFrame();
  }
}

/**
 * Called every audio frame with new DOA data.
 *
 * @param {number} azimuthRad  - Raw ambisonic azimuth in radians
 * @param {number} elevationRad - Elevation in radians
 * @param {number} energy      - Raw energy value
 * @param {number} time        - Current playback time in seconds
 */
export function updateDOAOverlay(azimuthRad, elevationRad, energy, time) {
  // Convert ambisonic azimuth to compass bearing using device calibration
  const compassBearing = DEVICE_HEADING_DEG - (azimuthRad * 180) / Math.PI;
  currentBearing = ((compassBearing % 360) + 360) % 360;
  currentElevation = (elevationRad * 180) / Math.PI;
  currentEnergy = energy;
  isActive = energy > 1e-12;

  // Trail sample
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
 * Hide the overlay (no data / stopped)
 */
export function hideDOAOverlay() {
  isActive = false;
  currentEnergy = 0;
  drawFrame();
}

/**
 * Clear trail history (on reset)
 */
export function clearDOAOverlayTrail() {
  trail = [];
  lastTrailTime = -1;
}

// ─── Drawing ───────────────────────────────────────────────

function drawFrame() {
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  // Read the current camera heading from the Cesium viewer so the radar
  // rotates to match the map orientation.  Heading is 0 when the camera
  // faces north and increases clockwise (in radians).
  if (state.viewer && state.viewer.camera) {
    cameraHeadingRad = state.viewer.camera.heading || 0;
  }

  const visualEnergy = isActive
    ? Math.min(1, Math.max(0, (Math.log10(currentEnergy + 1e-10) + 6) / 6))
    : 0;

  // Draw the static background (not rotated — stays circular)
  drawBackground();

  // Rotate the entire compass + DOA drawing so North on the radar matches
  // North on the map.  We rotate by -cameraHeading because when the camera
  // faces east (heading = pi/2), North is to the left of the screen, so the
  // "N" label should appear at the 9-o'clock position (i.e. rotated -pi/2).
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-cameraHeadingRad);
  ctx.translate(-cx, -cy);

  drawGridRings();
  drawCardinals();
  drawTrail(visualEnergy);
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
  // Outer circle fill
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 8, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(10, 14, 23, 0.88)';
  ctx.fill();

  // Outer ring border
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 8, 0, Math.PI * 2);
  ctx.strokeStyle = '#233554';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function drawGridRings() {
  // Concentric range rings at 33%, 66%, 100%
  for (let frac of [0.33, 0.66, 1.0]) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius * frac, 0, Math.PI * 2);
    ctx.strokeStyle = frac === 1.0 ? 'rgba(35, 53, 84, 0.8)' : 'rgba(35, 53, 84, 0.35)';
    ctx.lineWidth = frac === 1.0 ? 1.2 : 0.6;
    ctx.stroke();
  }

  // Cross-hair lines (N-S, E-W)
  ctx.strokeStyle = 'rgba(35, 53, 84, 0.3)';
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(cx, cy - radius);
  ctx.lineTo(cx, cy + radius);
  ctx.moveTo(cx - radius, cy);
  ctx.lineTo(cx + radius, cy);
  ctx.stroke();

  // 30-degree tick marks around the outer ring
  for (let deg = 0; deg < 360; deg += 30) {
    const rad = (deg - 90) * Math.PI / 180;
    const isCardinal = deg % 90 === 0;
    const inner = isCardinal ? radius - 8 : radius - 5;
    const outer = radius;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(rad) * inner, cy + Math.sin(rad) * inner);
    ctx.lineTo(cx + Math.cos(rad) * outer, cy + Math.sin(rad) * outer);
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
    const lx = cx + Math.cos(rad) * dist;
    const ly = cy + Math.sin(rad) * dist;

    // Counter-rotate the text so labels always read upright regardless of
    // the compass rotation applied by the camera heading.
    ctx.save();
    ctx.translate(lx, ly);
    ctx.rotate(cameraHeadingRad); // undo the -cameraHeadingRad from drawFrame
    ctx.fillStyle = color;
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }
}

function drawTrail(visualEnergy) {
  if (trail.length < 2) return;

  const now = trail[trail.length - 1].time;

  for (let i = 0; i < trail.length; i++) {
    const pt = trail[i];
    const age = now - pt.time;
    const maxAge = MAX_TRAIL * TRAIL_INTERVAL;
    const fade = Math.max(0, 1 - age / maxAge);

    const bearingRad = (pt.bearing - 90) * Math.PI / 180;
    const dist = (0.25 + pt.energy * 0.45) * radius;

    const x = cx + Math.cos(bearingRad) * dist;
    const y = cy + Math.sin(bearingRad) * dist;

    ctx.beginPath();
    ctx.arc(x, y, 1.5 + pt.energy * 2, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 154, 31, ${fade * 0.5 * pt.energy})`;
    ctx.fill();
  }
}

function drawEnergyRing(visualEnergy) {
  if (visualEnergy < 0.01) return;

  const pulseRadius = radius * (0.2 + visualEnergy * 0.15);
  const now = performance.now() / 1000;
  const pulse = 0.5 + 0.5 * Math.sin(now * 4); // gentle pulse

  ctx.beginPath();
  ctx.arc(cx, cy, pulseRadius, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(100, 255, 218, ${(0.15 + visualEnergy * 0.35) * (0.7 + pulse * 0.3)})`;
  ctx.lineWidth = 1.5 + visualEnergy * 2;
  ctx.stroke();

  // Second ring, slightly larger, fainter
  ctx.beginPath();
  ctx.arc(cx, cy, pulseRadius + 4 + visualEnergy * 3, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(100, 255, 218, ${(0.05 + visualEnergy * 0.15) * (0.7 + pulse * 0.3)})`;
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawDOAArrow(visualEnergy) {
  // Convert bearing to canvas angle: bearing 0 = north = up = -90 degrees in canvas coords
  const bearingRad = (currentBearing - 90) * Math.PI / 180;

  const arrowLength = radius * 0.85;
  const tipX = cx + Math.cos(bearingRad) * arrowLength;
  const tipY = cy + Math.sin(bearingRad) * arrowLength;

  // Glow line from center to tip
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

  // Arrowhead
  const headLen = 10 + visualEnergy * 4;
  const headAngle = 0.4;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(
    tipX - headLen * Math.cos(bearingRad - headAngle),
    tipY - headLen * Math.sin(bearingRad - headAngle)
  );
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(
    tipX - headLen * Math.cos(bearingRad + headAngle),
    tipY - headLen * Math.sin(bearingRad + headAngle)
  );
  ctx.strokeStyle = `rgba(0, 229, 255, ${0.7 + visualEnergy * 0.3})`;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Bright tip dot
  ctx.beginPath();
  ctx.arc(tipX, tipY, 3 + visualEnergy * 2, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(0, 229, 255, ${0.6 + visualEnergy * 0.4})`;
  ctx.fill();

  // Subtle glow behind the tip
  const glowGrad = ctx.createRadialGradient(tipX, tipY, 0, tipX, tipY, 12 + visualEnergy * 8);
  glowGrad.addColorStop(0, `rgba(0, 229, 255, ${0.2 * visualEnergy})`);
  glowGrad.addColorStop(1, 'rgba(0, 229, 255, 0)');
  ctx.beginPath();
  ctx.arc(tipX, tipY, 12 + visualEnergy * 8, 0, Math.PI * 2);
  ctx.fillStyle = glowGrad;
  ctx.fill();
}

function drawCenterDot(visualEnergy) {
  // Center dot
  const glow = isActive ? 0.3 + visualEnergy * 0.5 : 0.2;
  ctx.beginPath();
  ctx.arc(cx, cy, 3, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(100, 255, 218, ${glow})`;
  ctx.fill();

  if (isActive) {
    const glowGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 8);
    glowGrad.addColorStop(0, `rgba(100, 255, 218, ${0.15 * visualEnergy})`);
    glowGrad.addColorStop(1, 'rgba(100, 255, 218, 0)');
    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, Math.PI * 2);
    ctx.fillStyle = glowGrad;
    ctx.fill();
  }
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
