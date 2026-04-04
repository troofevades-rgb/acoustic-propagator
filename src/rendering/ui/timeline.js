/**
 * Timeline component with waveform display, spectrogram, markers, and scrubbing
 */

import { state } from '../../core/state.js';
import { WAVE_COLORS_CSS } from '../../core/physics.js';

let waveformCanvas = null;
let waveformCtx = null;
let spectrogramCanvas = null;
let spectrogramCtx = null;
let spectrogramMode = false;

/**
 * Initialize timeline canvases inside the time-bar element
 */
export function initTimeline() {
  const timeBar = document.getElementById('time-bar');
  if (!timeBar) return;

  // Waveform canvas
  waveformCanvas = document.createElement('canvas');
  waveformCanvas.style.position = 'absolute';
  waveformCanvas.style.top = '0';
  waveformCanvas.style.left = '0';
  waveformCanvas.style.width = '100%';
  waveformCanvas.style.height = '100%';
  waveformCanvas.style.pointerEvents = 'none';
  waveformCanvas.style.opacity = '0.5';
  timeBar.insertBefore(waveformCanvas, timeBar.firstChild);
  waveformCtx = waveformCanvas.getContext('2d');

  // Spectrogram canvas (hidden by default)
  spectrogramCanvas = document.createElement('canvas');
  spectrogramCanvas.style.position = 'absolute';
  spectrogramCanvas.style.top = '0';
  spectrogramCanvas.style.left = '0';
  spectrogramCanvas.style.width = '100%';
  spectrogramCanvas.style.height = '100%';
  spectrogramCanvas.style.pointerEvents = 'none';
  spectrogramCanvas.style.display = 'none';
  spectrogramCanvas.style.opacity = '0.7';
  timeBar.insertBefore(spectrogramCanvas, timeBar.firstChild);
  spectrogramCtx = spectrogramCanvas.getContext('2d');

  // Resize observer
  const resizeObs = new ResizeObserver(() => resizeCanvases());
  resizeObs.observe(timeBar);
  resizeCanvases();
}

function resizeCanvases() {
  const timeBar = document.getElementById('time-bar');
  if (!timeBar) return;
  const rect = timeBar.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;

  [waveformCanvas, spectrogramCanvas].forEach((canvas) => {
    if (!canvas) return;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.getContext('2d').scale(dpr, dpr);
  });

  // Redraw if we have data
  if (state.wavData) {
    renderWaveform();
    if (spectrogramMode) renderSpectrogram();
  }
}

/**
 * Render waveform envelope for all channels
 */
export function renderWaveform() {
  if (!waveformCanvas || !waveformCtx || !state.wavData) return;

  const ctx = waveformCtx;
  const rect = waveformCanvas.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;

  ctx.clearRect(0, 0, w, h);

  const { channels, frames } = state.wavData;
  const channelColors = ['#00e5ff', '#ff3d71', '#33ff88', '#cc33ff']; // W, X, Y, Z

  const samplesPerPixel = Math.max(1, Math.floor(frames / w));
  const centerY = h / 2;
  const scale = h * 0.4;

  channels.forEach((chan, chIdx) => {
    if (chIdx >= 4) return;
    ctx.beginPath();
    ctx.strokeStyle = channelColors[chIdx];
    ctx.lineWidth = 0.8;
    ctx.globalAlpha = chIdx === 0 ? 0.8 : 0.4;

    for (let px = 0; px < w; px++) {
      const startSample = Math.floor((px / w) * frames);
      const endSample = Math.min(frames, startSample + samplesPerPixel);

      let max = 0;
      for (let s = startSample; s < endSample; s++) {
        const abs = Math.abs(chan[s]);
        if (abs > max) max = abs;
      }

      const y = centerY - max * scale;
      if (px === 0) ctx.moveTo(px, y);
      else ctx.lineTo(px, y);
    }

    // Mirror bottom
    for (let px = w - 1; px >= 0; px--) {
      const startSample = Math.floor((px / w) * frames);
      const endSample = Math.min(frames, startSample + samplesPerPixel);

      let max = 0;
      for (let s = startSample; s < endSample; s++) {
        const abs = Math.abs(chan[s]);
        if (abs > max) max = abs;
      }

      const y = centerY + max * scale;
      ctx.lineTo(px, y);
    }

    ctx.closePath();
    ctx.fillStyle = channelColors[chIdx];
    ctx.globalAlpha = chIdx === 0 ? 0.15 : 0.06;
    ctx.fill();
    ctx.globalAlpha = chIdx === 0 ? 0.6 : 0.3;
    ctx.stroke();
  });

  ctx.globalAlpha = 1;
}

/**
 * Render spectrogram using FFT
 */
export function renderSpectrogram() {
  if (!spectrogramCanvas || !spectrogramCtx || !state.wavData) return;

  const ctx = spectrogramCtx;
  const rect = spectrogramCanvas.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;

  ctx.clearRect(0, 0, w, h);

  const { channels, sampleRate, frames } = state.wavData;
  const fftSize = 2048;
  const hopSize = Math.max(1, Math.floor(frames / w));
  const channel = channels[0]; // Use W channel

  // Simple magnitude spectrum via DFT (no external FFT library)
  for (let px = 0; px < w; px++) {
    const startSample = Math.floor((px / w) * frames);
    const endSample = Math.min(frames, startSample + fftSize);
    const blockSize = endSample - startSample;

    if (blockSize < 64) continue;

    // Compute magnitude spectrum for a few frequency bins
    const numBins = Math.min(h, 128);
    for (let bin = 0; bin < numBins; bin++) {
      const freq = (bin / numBins) * (sampleRate / 2);
      const omega = (2 * Math.PI * freq) / sampleRate;

      let real = 0, imag = 0;
      for (let n = 0; n < blockSize; n++) {
        const sample = channel[startSample + n];
        real += sample * Math.cos(omega * n);
        imag -= sample * Math.sin(omega * n);
      }

      const mag = Math.sqrt(real * real + imag * imag) / blockSize;
      const db = 20 * Math.log10(Math.max(1e-6, mag));
      const normalized = Math.max(0, Math.min(1, (db + 60) / 60));

      const y = h - (bin / numBins) * h;
      ctx.fillStyle = spectrogramColor(normalized);
      ctx.fillRect(px, y, 1, Math.max(1, h / numBins));
    }
  }
}

function spectrogramColor(value) {
  // Hot colormap: black → blue → cyan → yellow → white
  const r = Math.floor(Math.min(255, value * 4 * 255));
  const g = Math.floor(Math.min(255, Math.max(0, (value - 0.25) * 4 * 255)));
  const b = Math.floor(Math.min(255, Math.max(0, value < 0.5 ? value * 2 * 255 : (1 - value) * 2 * 255)));
  return `rgb(${r},${g},${b})`;
}

/**
 * Toggle between waveform and spectrogram view
 */
export function toggleSpectrogramMode() {
  spectrogramMode = !spectrogramMode;
  if (waveformCanvas) waveformCanvas.style.display = spectrogramMode ? 'none' : 'block';
  if (spectrogramCanvas) spectrogramCanvas.style.display = spectrogramMode ? 'block' : 'none';

  if (spectrogramMode && state.wavData) {
    renderSpectrogram();
  }

  return spectrogramMode;
}

/**
 * Update arrival markers on the timeline
 */
export function updateArrivalMarkers() {
  const container = document.getElementById('arrivalMarkers');
  if (!container) return;

  let html = '';

  // Direct arrival
  const directFrac = (state.directTime / state.maxSimTime) * 100;
  if (directFrac <= 100) {
    html += `<div class="time-marker" style="left:${directFrac}%; background: var(--accent);"></div>`;
    html += `<div class="time-label" style="left:${directFrac}%; color: var(--accent);">DIRECT ${(state.directTime * 1000).toFixed(1)}ms</div>`;
  }

  // Reflection arrivals
  const colors = ['#ff9a1f', '#cc33ff', '#33ff88'];
  state.reflections.slice(0, 6).forEach((r) => {
    const frac = (r.arrivalTime / state.maxSimTime) * 100;
    if (frac <= 100) {
      const col = colors[Math.min(r.order - 1, 2)];
      html += `<div class="time-marker" style="left:${frac}%; background: ${col};"></div>`;
    }
  });

  // User markers
  state.timelineMarkers.forEach((marker) => {
    const frac = (marker.time / state.maxSimTime) * 100;
    if (frac <= 100) {
      html += `<div class="time-marker" style="left:${frac}%; background: #fff; width: 1px;"></div>`;
      html += `<div class="time-label" style="left:${frac}%; color: #fff; top: auto; bottom: 2px; font-size: 7px;">${marker.label}</div>`;
    }
  });

  container.innerHTML = html;
}

/**
 * Update the playhead position and time display
 */
export function updateTimelineUI() {
  const frac = state.maxSimTime > 0 ? (state.simTime / state.maxSimTime) * 100 : 0;
  const playhead = document.getElementById('playhead');
  const simDisplay = document.getElementById('simTimeDisplay');
  const durDisplay = document.getElementById('durationDisplay');
  if (playhead) playhead.style.left = Math.min(100, frac) + '%';
  if (simDisplay) simDisplay.textContent = state.simTime.toFixed(3);
  if (durDisplay) durDisplay.textContent = state.maxSimTime.toFixed(3);
}

/**
 * Seek timeline to a position based on click event
 */
export function seekTimeline(event) {
  const bar = document.getElementById('time-bar');
  if (!bar) return;
  const rect = bar.getBoundingClientRect();
  const frac = (event.clientX - rect.left) / rect.width;
  state.simTime = Math.max(0, Math.min(state.maxSimTime, frac * state.maxSimTime));
}

/**
 * Add a user marker at the current sim time
 */
export function addTimelineMarker(label) {
  state.timelineMarkers.push({
    time: state.simTime,
    label: label || `M${state.timelineMarkers.length + 1}`,
  });
  updateArrivalMarkers();
}

/**
 * Remove a timeline marker by index
 */
export function removeTimelineMarker(index) {
  state.timelineMarkers.splice(index, 1);
  updateArrivalMarkers();
}
