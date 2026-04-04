/**
 * HUD panel logic — DOA display, WAV info, UI sync
 */

import { state } from '../core/state.js';

/**
 * Update the audio analysis stats panel
 */
export function updateStatsDisplay() {
  // DOA display updates happen in updateDOADisplay
}

/**
 * Update DOA info in the stats panel
 */
export function updateDOADisplay(azimuthDeg, elevationDeg, energy) {
  const el = document.getElementById('doaDisplay');
  if (!el) return;

  if (energy < 0.001) {
    el.innerHTML = '<span class="dim">No significant energy</span>';
    return;
  }

  el.innerHTML =
    `<div>Bearing: <span class="accent">${azimuthDeg.toFixed(1)}°</span> <span class="dim">compass</span></div>` +
    `<div>Elevation: <span class="accent">${elevationDeg.toFixed(1)}°</span></div>` +
    `<div>Energy: <span class="accent">${(energy * 100).toFixed(1)}</span></div>`;
}

/**
 * Update the speed of sound display
 */
export function updateSosDisplay() {
  const computedSos = document.getElementById('computedSos');
  const sosDisplay = document.getElementById('sosDisplay');
  if (computedSos) computedSos.textContent = state.speedOfSound.toFixed(2);
  if (sosDisplay) sosDisplay.textContent = state.speedOfSound.toFixed(2);
}

/**
 * Show WAV file info in the panel
 */
export function showWavInfo(fileName, wavData) {
  const wavInfo = document.getElementById('wavInfo');
  if (wavInfo) {
    wavInfo.innerHTML =
      `<span style="color:var(--accent)">✓</span> ${fileName}<br>` +
      `${wavData.numChannels}ch · ${wavData.sampleRate}Hz · ${wavData.duration.toFixed(3)}s` +
      (wavData.numChannels >= 4
        ? '<br><span style="color:#ff9a1f">Spatial audio detected — DOA analysis active</span>'
        : '<br><span class="dim">Mono/stereo — no DOA available</span>');
  }

  const directStats = document.getElementById('directStats');
  if (directStats) {
    directStats.innerHTML = `<span class="accent">✓</span> Audio loaded — ${wavData.numChannels}ch ${wavData.sampleRate}Hz`;
  }
}

/**
 * Show WAV load error
 */
export function showWavError(message) {
  const wavInfo = document.getElementById('wavInfo');
  if (wavInfo) {
    wavInfo.innerHTML = `<span style="color:var(--source)">✗</span> Error: ${message}`;
  }
}

/**
 * Sync UI inputs with state (e.g., after restoring config)
 */
export function syncUIWithState() {
  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val;
  };
  const setChecked = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.checked = val;
  };

  setVal('micLat', state.listener.lat);
  setVal('micLon', state.listener.lon);
  setVal('micHeight', state.listener.height);
  setVal('tempF', state.tempF);
  setVal('rh', state.rh);
  setVal('speedSlider', state.simSpeed);
  setVal('windowSlider', state.maxSimTime * 1000);

  setChecked('chkWaves', state.showWaves);
  setChecked('chkReflections', state.showReflections);
  setChecked('chkPaths', state.showPaths);
  setChecked('chkParticles', state.showParticles);
  setChecked('chkDOA', state.showDOA);
  setChecked('chkAudio', state.spatialAudioEnabled);

  // Volume slider
  const volPct = Math.round((state.volume ?? 0.8) * 100);
  setVal('volumeSlider', volPct);
  const volumeValue = document.getElementById('volumeValue');
  if (volumeValue) volumeValue.textContent = volPct + '%';

  const speedValue = document.getElementById('speedValue');
  if (speedValue) speedValue.textContent = state.simSpeed.toFixed(3) + '×';
  const windowValue = document.getElementById('windowValue');
  if (windowValue) windowValue.textContent = (state.maxSimTime * 1000).toFixed(0) + 'ms';

  updateSosDisplay();
}
