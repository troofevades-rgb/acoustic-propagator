/**
 * Input bindings, keyboard shortcuts, camera views
 */

const Cesium = window.Cesium;
import { state } from '../core/state.js';
import { CONFIG, computeSpeedOfSound, getCartesian3 } from '../core/physics.js';
import { updateSosDisplay } from './hud.js';

let onInputChangeCallback = null;
let onTogglePropagationCallback = null;
let onResetSimCallback = null;
let onLoadWavCallback = null;
let onVolumeChangeCallback = null;
let onClearConfigCallback = null;

/**
 * Set callbacks for main app coordination
 */
export function setControlCallbacks({
  onInputChange,
  onTogglePropagation,
  onResetSim,
  onLoadWav,
  onVolumeChange,
  onClearConfig,
}) {
  onInputChangeCallback = onInputChange;
  onTogglePropagationCallback = onTogglePropagation;
  onResetSimCallback = onResetSim;
  onLoadWavCallback = onLoadWav;
  onVolumeChangeCallback = onVolumeChange || null;
  onClearConfigCallback = onClearConfig || null;
}

/**
 * Bind all UI input events
 */
export function bindInputs() {
  // Listener position
  ['micLat', 'micLon', 'micHeight'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', () => {
        state.listener.lat = parseFloat(document.getElementById('micLat').value);
        state.listener.lon = parseFloat(document.getElementById('micLon').value);
        state.listener.height = parseFloat(document.getElementById('micHeight').value);
        if (onInputChangeCallback) onInputChangeCallback();
      });
    }
  });

  // Environment
  ['tempF', 'rh'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', () => {
        state.tempF = parseInt(document.getElementById('tempF').value);
        state.rh = parseInt(document.getElementById('rh').value);
        state.speedOfSound = computeSpeedOfSound(state.tempF, state.rh);
        updateSosDisplay();
        if (onInputChangeCallback) onInputChangeCallback();
      });
    }
  });

  // Layer toggles
  bindCheckbox('chkWaves', (v) => (state.showWaves = v));
  bindCheckbox('chkReflections', (v) => (state.showReflections = v));
  bindCheckbox('chkPaths', (v) => (state.showPaths = v));
  bindCheckbox('chkParticles', (v) => (state.showParticles = v));
  bindCheckbox('chkDOA', (v) => (state.showDOA = v));
  bindCheckbox('chkAudio', (v) => {
    state.spatialAudioEnabled = v;
  });

  // Reflection mode toggle
  const reflModeEl = document.getElementById('reflectionMode');
  if (reflModeEl) {
    reflModeEl.addEventListener('change', (e) => {
      state.reflectionMode = e.target.value;
      if (onInputChangeCallback) onInputChangeCallback();
    });
  }

  // (Speed slider removed — playback is real-time)

  // Volume slider
  const volumeSlider = document.getElementById('volumeSlider');
  if (volumeSlider) {
    // Sync slider to persisted volume state
    volumeSlider.value = Math.round(state.volume * 100);
    const volumeValue = document.getElementById('volumeValue');
    if (volumeValue) volumeValue.textContent = Math.round(state.volume * 100) + '%';

    volumeSlider.addEventListener('input', () => {
      const vol = parseInt(volumeSlider.value);
      const vv = document.getElementById('volumeValue');
      if (vv) vv.textContent = vol + '%';
      state.volume = vol / 100;
      if (onVolumeChangeCallback) onVolumeChangeCallback(state.volume);
    });
  }

  // Clear config button (resets persisted settings)
  const btnClearConfig = document.getElementById('btnClearConfig');
  if (btnClearConfig) {
    btnClearConfig.addEventListener('click', () => {
      if (onClearConfigCallback) onClearConfigCallback();
    });
  }

  // WAV loading button
  const btnLoadWav = document.getElementById('btnLoadWav');
  if (btnLoadWav) {
    btnLoadWav.addEventListener('click', () => {
      if (onLoadWavCallback) onLoadWavCallback();
    });
  }

  // Propagate / Reset buttons
  const btnPropagate = document.getElementById('btnPropagate');
  if (btnPropagate) {
    btnPropagate.addEventListener('click', () => {
      if (onTogglePropagationCallback) onTogglePropagationCallback();
    });
  }

  const btnReset = document.getElementById('btnReset');
  if (btnReset) {
    btnReset.addEventListener('click', () => {
      if (onResetSimCallback) onResetSimCallback();
    });
  }

  // Keyboard shortcuts
  document.addEventListener('keydown', handleKeyDown);
}

function bindCheckbox(id, setter) {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener('change', (e) => setter(e.target.checked));
  }
}

function handleKeyDown(e) {
  // Don't capture when typing in inputs
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  switch (e.key) {
    case ' ':
      e.preventDefault();
      if (onTogglePropagationCallback) onTogglePropagationCallback();
      break;
    case 'r':
      if (onResetSimCallback) onResetSimCallback();
      break;
    case '1':
      setView('overview');
      break;
    case '2':
      setView('fpv');
      break;
    case '3':
      setView('top');
      break;
    case '4':
      setView('orbit');
      break;
    case 'm':
      // Add timeline marker at current time
      // Imported dynamically to avoid circular dependency
      import('../ui/timeline.js').then(({ addTimelineMarker }) => {
        addTimelineMarker();
      });
      break;
    case 's':
      if (e.ctrlKey && e.shiftKey) {
        e.preventDefault();
        captureScreenshot();
      }
      break;
  }
}

/**
 * Camera view presets
 */
export function setView(viewName) {
  state.currentView = viewName;

  // Update button styling
  document.querySelectorAll('#header .btn-sm').forEach((b) => b.classList.remove('selected'));
  const btn = document.getElementById(
    'btn' + viewName.charAt(0).toUpperCase() + viewName.slice(1)
  );
  if (btn) btn.classList.add('selected');

  // Crosshair visibility
  const crosshair = document.getElementById('crosshair');
  if (crosshair) crosshair.classList.toggle('visible', viewName === 'fpv');

  const viewer = state.viewer;
  if (!viewer) return;

  const center = CONFIG.defaultCenter;

  switch (viewName) {
    case 'overview':
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(
          center.lon, center.lat, center.height + 80
        ),
        orientation: {
          heading: Cesium.Math.toRadians(30),
          pitch: Cesium.Math.toRadians(-45),
          roll: 0,
        },
        duration: 1.5,
      });
      break;

    case 'fpv': {
      const lisCart = getCartesian3(state.listener);
      const srcCart = getCartesian3(state.source);
      const direction = Cesium.Cartesian3.subtract(
        srcCart, lisCart, new Cesium.Cartesian3()
      );
      Cesium.Cartesian3.normalize(direction, direction);

      const heading = Cesium.Math.toDegrees(
        Cesium.Cartesian3.angleBetween(
          new Cesium.Cartesian3(0, 1, 0),
          new Cesium.Cartesian3(direction.x, direction.y, 0)
        )
      );

      viewer.camera.flyTo({
        destination: lisCart,
        orientation: {
          heading: Cesium.Math.toRadians(heading),
          pitch: Cesium.Math.toRadians(-5),
          roll: 0,
        },
        duration: 1.5,
      });
      break;
    }

    case 'top':
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(
          center.lon, center.lat, center.height + 120
        ),
        orientation: {
          heading: 0,
          pitch: Cesium.Math.toRadians(-90),
          roll: 0,
        },
        duration: 1.5,
      });
      break;

    case 'orbit':
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(
          center.lon - 0.001, center.lat, center.height + 25
        ),
        orientation: {
          heading: Cesium.Math.toRadians(60),
          pitch: Cesium.Math.toRadians(-20),
          roll: 0,
        },
        duration: 1.5,
      });
      break;

    case 'followWavefront': {
      // Camera follows the expanding wavefront
      const srcCart = getCartesian3(state.source);
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(
          state.source.lon + 0.0003,
          state.source.lat,
          CONFIG.defaultCenter.height + state.source.height + 10
        ),
        orientation: {
          heading: Cesium.Math.toRadians(270),
          pitch: Cesium.Math.toRadians(-30),
          roll: 0,
        },
        duration: 1.5,
      });
      break;
    }
  }
}

/**
 * Capture a screenshot of the current view
 */
async function captureScreenshot() {
  const viewer = state.viewer;
  if (!viewer) return;

  viewer.render();
  const canvas = viewer.scene.canvas;
  const dataUrl = canvas.toDataURL('image/png');

  if (window.electronAPI) {
    const path = await window.electronAPI.saveScreenshot(dataUrl);
    if (path) console.log('Screenshot saved:', path);
  } else {
    // Browser fallback: download
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `acoustic-propagator-${Date.now()}.png`;
    a.click();
  }
}
