/**
 * ACOUSTIC PROPAGATOR — Main Application Entry Point
 *
 * Listener-centric: the MIC position is where the recording device was.
 * Load a spatial audio WAV → the app decodes it, plays it back,
 * and analyzes the B-format ambisonics for direction of arrival (DOA).
 */

import { initCesium } from './core/cesium-init.js';
import { state, getSerializableState, restoreState } from './core/state.js';
import { computeSpeedOfSound } from './core/physics.js';
import { parseWav } from './core/wav-parser.js';
import { computeDOATrack, ambiXToCompass } from './core/ambisonics.js';
import { HEADING_TRACK } from './core/heading-track.js';
import { SpatialAudioEngine } from './core/spatial-audio.js';
import { initWavefrontPools, renderWavefronts } from './rendering/wavefronts.js';
import { initParticleSystem, updateParticles, updateParticlePosition } from './rendering/particles.js';
import { createMarkerEntities, updateMarkerPositions, updateDOAArrow } from './rendering/annotations.js';
import { updateStatsDisplay, updateDOADisplay, updateSosDisplay, showWavInfo, showWavError, syncUIWithState } from './rendering/ui/hud.js';
import {
  initTimeline,
  renderWaveform,
  updateArrivalMarkers,
  updateTimelineUI,
  seekTimeline,
  toggleSpectrogramMode,
} from './rendering/ui/timeline.js';
import { bindInputs, setControlCallbacks, setView } from './rendering/ui/controls.js';
import { exportSession, exportDOATrack, startRecording, stopRecording } from './core/export.js';
import { initCompass } from './rendering/ui/compass.js';
import { initMarkerDrag } from './rendering/ui/marker-drag.js';
import { createSceneMarkers } from './rendering/scene-markers.js';
import { initDOAVisuals, updateDOAVisuals, hideAll as hideDOAVisuals, clearDOATrail } from './rendering/doa-visuals.js';
import { initDOAOverlay, updateDOAOverlay, hideDOAOverlay, clearDOAOverlayTrail } from './rendering/ui/doa-overlay.js';

// ─── Audio engine ───
const audioEngine = new SpatialAudioEngine();

// ─── DOA analysis track ───
let doaTrack = null;

// ─── Animation frame ID ───
let animFrameId = null;


// ─── Main initialization ───
async function init() {
  // Restore persisted config
  if (window.electronAPI) {
    try {
      const config = await window.electronAPI.loadConfig();
      restoreState(config);
    } catch (e) {
      console.warn('Failed to load config:', e);
    }
  }

  // Set default listener position only if restored config doesn't have valid coordinates
  if (!state.listener.lat || !state.listener.lon) {
    state.listener.lat = 40.2776602;
    state.listener.lon = -111.7140867;
    state.listener.height = 1.0;
  }

  // Ensure critical visual layers default to ON
  state.showDOA = true;
  state.showWaves = true;
  state.showPaths = true;

  // Apply persisted volume to the audio engine
  audioEngine.setVolume(state.volume);

  // Set up control callbacks
  setControlCallbacks({
    onInputChange: handleInputChange,
    onTogglePropagation: togglePlayback,
    onResetSim: resetPlayback,
    onLoadWav: handleLoadWav,
    onVolumeChange: (vol) => audioEngine.setVolume(vol),
    onClearConfig: clearConfig,
  });

  bindInputs();
  syncUIWithState();
  initTimeline();

  // Initialize CesiumJS
  const viewer = await initCesium();

  // Create listener marker + DOA arrow
  createMarkerEntities(viewer);

  // Add scene markers (speakers, tent, mics, muzzle)
  createSceneMarkers(viewer);

  // Visual systems
  // NOTE: initWavefrontPools() is intentionally disabled — it creates pooled
  // entities that conflict with Cesium's rendering pipeline (see wavefronts.js).
  initDOAVisuals(viewer);
  initParticleSystem(viewer);
  initCompass(viewer);
  initMarkerDrag(viewer, handleInputChange);
  initDOAOverlay();

  // Timeline click-to-seek
  const timeBar = document.getElementById('time-bar');
  if (timeBar) {
    timeBar.addEventListener('click', (e) => {
      const rect = timeBar.getBoundingClientRect();
      const frac = (e.clientX - rect.left) / rect.width;
      const seekTime = frac * state.maxSimTime;
      state.simTime = Math.max(0, Math.min(state.maxSimTime, seekTime));

      // Seek audio to match
      if (audioEngine.duration > 0) {
        audioEngine.seek(state.simTime);
      }

      updateTimelineUI();
    });
  }

  // Spectrogram toggle
  const btnSpectrogram = document.getElementById('btnSpectrogram');
  if (btnSpectrogram) {
    btnSpectrogram.addEventListener('click', () => {
      const isSpec = toggleSpectrogramMode();
      btnSpectrogram.textContent = isSpec ? 'WAVEFORM' : 'SPECTROGRAM';
    });
  }

  // Session export/import
  bindSessionButtons(viewer);

  // Auto-save config periodically
  setInterval(persistConfig, 30000);

  // Expose setView for HTML onclick
  window.setView = setView;

  // Start the animation loop
  startAnimationLoop();

  console.log('Acoustic Propagator initialized');
}

// ─── Animation loop (runs continuously) ───
function startAnimationLoop() {
  function tick() {
    animFrameId = requestAnimationFrame(tick);

    if (!audioEngine.isPlaying && !state.simRunning) return;

    if (audioEngine.isPlaying) {
      state.simTime = audioEngine.getCurrentTime();

      // Update DOA visuals — interpolate between pre-computed multi-band DOA frames
      if (doaTrack && doaTrack.length > 0 && state.wavData) {
        const frac = state.simTime / state.wavData.duration;
        const exactIdx = frac * doaTrack.length;
        const idx0 = Math.min(Math.floor(exactIdx), doaTrack.length - 1);
        const idx1 = Math.min(idx0 + 1, doaTrack.length - 1);
        const t = exactIdx - idx0;

        const d0 = doaTrack[idx0];
        const d1 = doaTrack[idx1];

        // Lerp raw azimuth/elevation/energy
        let azDiff = d1.azimuth - d0.azimuth;
        if (azDiff > Math.PI) azDiff -= 2 * Math.PI;
        if (azDiff < -Math.PI) azDiff += 2 * Math.PI;
        const azimuth = d0.azimuth + azDiff * t;
        const elevation = d0.elevation + (d1.elevation - d0.elevation) * t;
        const energy = d0.energy + (d1.energy - d0.energy) * t;

        // Lerp per-band azimuths
        const bands = {};
        for (const name of ['low', 'mid', 'high']) {
          const b0 = d0.bands && d0.bands[name], b1 = d1.bands && d1.bands[name];
          if (b0 && b1) {
            let bAzDiff = b1.azimuth - b0.azimuth;
            if (bAzDiff > Math.PI) bAzDiff -= 2 * Math.PI;
            if (bAzDiff < -Math.PI) bAzDiff += 2 * Math.PI;
            bands[name] = {
              azimuth: b0.azimuth + bAzDiff * t,
              energy: b0.energy + (b1.energy - b0.energy) * t,
            };
          }
        }

        if (idx0 >= 0) {
          updateDOAArrow(azimuth, elevation, energy);
          updateDOAVisuals(state.viewer, azimuth, elevation, energy, state.simTime, bands);
          updateDOAOverlay(azimuth, elevation, energy, state.simTime);

          const normalizedBearing = ambiXToCompass(azimuth, state.simTime);
          updateDOADisplay(
            normalizedBearing,
            (elevation * 180) / Math.PI,
            energy
          );
        }
      } else {
        hideDOAVisuals();
        hideDOAOverlay();
      }

      // Check if playback ended
      if (state.simTime >= state.maxSimTime) {
        state.simRunning = false;
        document.getElementById('statusDot')?.classList.remove('active');
        const btn = document.getElementById('btnPropagate');
        if (btn) btn.textContent = '▶ PLAY';
      }
    }

    // Update timeline playhead
    updateTimelineUI();
  }

  tick();
}

// ─── Playback controls ───
function togglePlayback() {
  if (audioEngine.isPlaying) {
    // Pause
    audioEngine.pause();
    state.simRunning = false;
    document.getElementById('statusDot')?.classList.remove('active');
    const btn = document.getElementById('btnPropagate');
    if (btn) btn.textContent = '▶ PLAY';
  } else {
    // Play
    if (!state.wavData) {
      // No audio loaded — show hint
      const directStats = document.getElementById('directStats');
      if (directStats) directStats.innerHTML = '<span style="color:var(--source)">Load a spatial audio WAV first</span>';
      return;
    }

    // If at the end, restart from beginning
    if (audioEngine.getCurrentTime() >= audioEngine.duration - 0.01) {
      audioEngine.seek(0);
      state.simTime = 0;
    }

    audioEngine.play();
    state.simRunning = true;
    document.getElementById('statusDot')?.classList.add('active');
    const btn = document.getElementById('btnPropagate');
    if (btn) btn.textContent = '■ PAUSE';
  }
}

function resetPlayback() {
  audioEngine.stop();
  audioEngine.seek(0);
  state.simRunning = false;
  state.simTime = 0;
  updateTimelineUI();
  updateDOAArrow(0, 0, 0);
  hideDOAVisuals();
  hideDOAOverlay();
  clearDOATrail(state.viewer);
  clearDOAOverlayTrail();
  document.getElementById('statusDot')?.classList.remove('active');
  const btn = document.getElementById('btnPropagate');
  if (btn) btn.textContent = '▶ PLAY';
}

// ─── Input change handler ───
function handleInputChange() {
  updateMarkerPositions();
  updateParticlePosition(state.viewer);

  if (audioEngine.ctx) {
    // Listener position changed — nothing else to recompute
    // since we have no source. DOA comes from the audio.
  }
}

// ─── DOA Worker helper ───
function computeDOAInWorker(channels, sampleRate, analysisRate, headingTrackData, calPointsData) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL('./core/doa-worker.js', import.meta.url),
      { type: 'classic' }
    );

    // Copy channel data into transferable ArrayBuffers
    const buffers = channels.map(ch => {
      const copy = new Float32Array(ch.length);
      copy.set(ch);
      return copy.buffer;
    });

    worker.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        const doaDisplay = document.getElementById('doaDisplay');
        if (doaDisplay) {
          const stage = msg.stage || '';
          doaDisplay.innerHTML = `<span class="dim">Computing DOA... ${msg.percent}% — ${stage}</span>`;
        }
      } else if (msg.type === 'done') {
        worker.terminate();
        resolve(msg.track);
      } else if (msg.type === 'error') {
        worker.terminate();
        reject(new Error(msg.message));
      }
    };

    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || 'Worker error'));
    };

    // Post with Transferable ArrayBuffers (zero-copy)
    worker.postMessage({
      channels: buffers,
      sampleRate,
      analysisRate,
      headingTrackData,
      calPointsData,
    }, buffers);
  });
}

// ─── WAV loading ───
async function handleLoadWav() {
  let fileData;
  if (window.electronAPI) {
    fileData = await window.electronAPI.openWavFile();
  } else {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.wav';
    input.click();
    fileData = await new Promise((resolve) => {
      input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return resolve(null);
        const buffer = await file.arrayBuffer();
        resolve({ name: file.name, buffer });
      };
    });
  }

  if (!fileData) return;

  try {
    // Ensure we have a proper ArrayBuffer
    let rawBuffer = fileData.buffer;
    if (rawBuffer instanceof Uint8Array) {
      rawBuffer = rawBuffer.buffer.slice(rawBuffer.byteOffset, rawBuffer.byteOffset + rawBuffer.byteLength);
    } else if (!(rawBuffer instanceof ArrayBuffer)) {
      const bytes = new Uint8Array(Object.values(rawBuffer));
      rawBuffer = bytes.buffer;
    }

    const wav = parseWav(rawBuffer);
    state.wavData = wav;

    // Load into audio engine (creates stereo decode for playback)
    const duration = audioEngine.loadWav(wav);

    // Set timeline window to match audio duration
    state.maxSimTime = duration;
    const windowSlider = document.getElementById('windowSlider');
    if (windowSlider) {
      windowSlider.max = Math.ceil(duration * 1000);
      windowSlider.value = Math.ceil(duration * 1000);
    }
    const windowValue = document.getElementById('windowValue');
    if (windowValue) windowValue.textContent = (duration * 1000).toFixed(0) + 'ms';

    // Update display
    showWavInfo(fileData.name, wav);

    // Enable audio checkbox
    const chkAudio = document.getElementById('chkAudio');
    if (chkAudio) chkAudio.checked = true;
    state.spatialAudioEnabled = true;

    // Validate WAV channel ordering (first 1 second)
    if (wav.numChannels >= 4) {
      const oneSecSamples = Math.min(wav.sampleRate, wav.channels[0].length);
      const channelLabels = ['W(omni)', 'Y(side)', 'Z(height)', 'X(front)'];
      const rmsValues = wav.channels.slice(0, 4).map((ch, i) => {
        let sum = 0;
        for (let s = 0; s < oneSecSamples; s++) sum += ch[s] * ch[s];
        const rms = Math.sqrt(sum / oneSecSamples);
        return { label: channelLabels[i], rms };
      });
      console.log('[WAV] Per-channel RMS (first 1s):', rmsValues.map(v => `${v.label}=${v.rms.toFixed(6)}`).join(', '));
      const wRms = rmsValues[0].rms;
      const maxOther = Math.max(rmsValues[1].rms, rmsValues[2].rms, rmsValues[3].rms);
      if (wRms < maxOther) {
        console.warn('[WAV] WARNING: W(omni) is NOT the highest RMS channel — channel ordering may be wrong!');
      } else {
        console.log('[WAV] Channel ordering OK: W(omni) has highest RMS');
      }
    }

    // Compute DOA track if 4-channel B-format (via Web Worker)
    if (wav.numChannels >= 4) {
      const doaDisplay = document.getElementById('doaDisplay');
      if (doaDisplay) {
        doaDisplay.innerHTML = '<span class="dim">Computing DOA... 0%</span>';
      }

      // Calibration points needed by the worker's heading logic
      const calPointsData = [
        { time: 25.37, heading: 131.4 },
        { time: 120.0, heading: 241.3 },
      ];

      try {
        doaTrack = await computeDOAInWorker(wav.channels, wav.sampleRate, 200, HEADING_TRACK, calPointsData);
        console.log('DOA track computed:', doaTrack.length, 'frames');

        // Log DOA track statistics
        if (doaTrack.length > 0) {
          let minAz = Infinity, maxAz = -Infinity, maxE = 0, peakIdx = 0;
          for (let i = 0; i < doaTrack.length; i++) {
            const azDeg = doaTrack[i].azimuth * 180 / Math.PI;
            if (azDeg < minAz) minAz = azDeg;
            if (azDeg > maxAz) maxAz = azDeg;
            if (doaTrack[i].energy > maxE) { maxE = doaTrack[i].energy; peakIdx = i; }
          }
          const peakDoa = doaTrack[peakIdx];
          const peakCompass = ambiXToCompass(peakDoa.azimuth, peakDoa.time);
          console.log(`[DOA] Azimuth range: ${minAz.toFixed(1)}° to ${maxAz.toFixed(1)}°`);
          console.log(`[DOA] Peak energy at t=${peakDoa.time.toFixed(2)}s, compass bearing=${peakCompass.toFixed(1)}°`);
        }

        if (doaDisplay) {
          doaDisplay.innerHTML = `<span class="accent">${doaTrack.length}</span> DOA frames computed — press PLAY`;
        }
      } catch (err) {
        console.error('[DOA Worker] Error:', err);
        // Fallback to synchronous computation
        console.log('[DOA] Falling back to main-thread computation');
        if (doaDisplay) {
          doaDisplay.innerHTML = '<span class="dim">Computing DOA (main thread)...</span>';
        }
        doaTrack = computeDOATrack(wav.channels, wav.sampleRate);
        console.log('DOA track computed (fallback):', doaTrack.length, 'frames');
        if (doaDisplay) {
          doaDisplay.innerHTML = `<span class="accent">${doaTrack.length}</span> DOA frames computed — press PLAY`;
        }
      }
    } else {
      doaTrack = null;
      const doaDisplay = document.getElementById('doaDisplay');
      if (doaDisplay) {
        doaDisplay.innerHTML = '<span class="dim">Not B-format — DOA unavailable</span>';
      }
    }

    // Set audio ended callback
    audioEngine.onEndedCallback = () => {
      state.simRunning = false;
      document.getElementById('statusDot')?.classList.remove('active');
      const btn = document.getElementById('btnPropagate');
      if (btn) btn.textContent = '▶ PLAY';
    };

    // Render waveform in timeline
    renderWaveform();

    // Reset playhead
    state.simTime = 0;
    updateTimelineUI();
    updateArrivalMarkers();

    // Update play button text
    const btn = document.getElementById('btnPropagate');
    if (btn) btn.textContent = '▶ PLAY';

    console.log('WAV loaded:', fileData.name, wav.numChannels, 'ch,', duration.toFixed(3) + 's');
  } catch (e) {
    console.error('WAV parse error:', e);
    showWavError(e.message);
  }
}

// ─── Session buttons ───
function bindSessionButtons(viewer) {
  const btnExport = document.getElementById('btnExportSession');
  if (btnExport) {
    btnExport.addEventListener('click', async () => {
      const session = exportSession();
      if (window.electronAPI) {
        await window.electronAPI.saveSession(session);
      } else {
        const blob = new Blob([JSON.stringify(session, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'acoustic-session.json';
        a.click();
      }
    });
  }

  const btnImport = document.getElementById('btnImportSession');
  if (btnImport) {
    btnImport.addEventListener('click', async () => {
      let session;
      if (window.electronAPI) {
        session = await window.electronAPI.loadSession();
      } else {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.click();
        session = await new Promise((resolve) => {
          input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return resolve(null);
            resolve(JSON.parse(await file.text()));
          };
        });
      }
      if (session) {
        restoreState(session);
        syncUIWithState();
        handleInputChange();
      }
    });
  }

  const btnRecord = document.getElementById('btnRecord');
  if (btnRecord) {
    btnRecord.addEventListener('click', () => {
      if (state.isRecording) {
        stopRecording();
        btnRecord.textContent = 'REC';
        btnRecord.classList.remove('active');
      } else {
        startRecording(viewer, audioEngine.getContext(), audioEngine.getDestination());
        btnRecord.textContent = '■ STOP REC';
        btnRecord.classList.add('active');
      }
    });
  }

  // DOA track export buttons
  const btnExportDOA = document.getElementById('btnExportDOA');
  if (btnExportDOA) {
    btnExportDOA.addEventListener('click', () => {
      if (!doaTrack || doaTrack.length === 0) {
        console.warn('No DOA track data — load a B-format WAV first');
        return;
      }
      exportDOATrack(doaTrack, 'csv');
    });
  }

  const btnExportDOAJson = document.getElementById('btnExportDOAJson');
  if (btnExportDOAJson) {
    btnExportDOAJson.addEventListener('click', () => {
      if (!doaTrack || doaTrack.length === 0) {
        console.warn('No DOA track data — load a B-format WAV first');
        return;
      }
      exportDOATrack(doaTrack, 'json');
    });
  }
}

// ─── Config persistence ───
async function persistConfig() {
  if (window.electronAPI) {
    try {
      await window.electronAPI.saveConfig(getSerializableState());
    } catch (e) { /* silent */ }
  }
}

/**
 * Clear persisted config file and reload with defaults.
 * Useful when a stale config causes unexpected behavior.
 */
async function clearConfig() {
  if (window.electronAPI) {
    try {
      // Save an empty config to wipe the file
      await window.electronAPI.saveConfig({});
      console.log('Config cleared — reloading with defaults');
      window.location.reload();
    } catch (e) {
      console.warn('Failed to clear config:', e);
    }
  }
}

// ─── Boot ───
document.addEventListener('DOMContentLoaded', () => {
  init().catch(console.error);
});
