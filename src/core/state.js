/**
 * Centralized application state
 * Single source of truth for all mutable state
 */

import { CONFIG } from './physics.js';

export const state = {
  viewer: null,
  tileset: null,

  // Positions (WGS84 degrees + height above ground in meters)
  source: {
    lat: 40.277504,
    lon: -111.713948,
    height: 2.0,
  },
  listener: {
    lat: 40.2776602,
    lon: -111.7140867,
    height: 1.0,
  },

  // Simulation
  simTime: 0,
  simRunning: false,
  simSpeed: 0.08,
  maxSimTime: 0.150,
  lastTimestamp: 0,

  // Environment
  tempF: 83,
  rh: 30,
  speedOfSound: CONFIG.speedOfSound,

  // Layers
  showWaves: true,
  showReflections: true,
  showPaths: true,
  showParticles: true,
  showDOA: true,
  showMeasurements: false,
  spatialAudioEnabled: false,

  // Audio
  audioCtx: null,
  audioBuffer: null,
  wavData: null,
  audioSource: null,
  volume: 0.8,

  // Reflection mode: 'auto' (ray-traced) or 'manual' (planar walls)
  reflectionMode: 'auto',

  // Cesium entities
  entities: {
    sourcePoint: null,
    listenerPoint: null,
    directPath: null,
    wavefronts: [],
    reflectionPaths: [],
    reflectionWavefronts: [],
    particles: [],
    doaArrow: null,
    doaTrail: [],
    measurements: [],
  },

  // Entity pools (Phase 9.1)
  pools: {
    wavefrontRings: [],
    reflectionRings: [],
    reflectionPathLines: [],
    particlePoints: [],
    maxWavefrontRings: 30,
    maxReflectionRings: 40,
    maxReflectionPaths: 20,
    maxParticles: 200,
  },

  // View
  currentView: 'overview',
  orbitAngle: 0,

  // Computed
  directDistance: 0,
  directTime: 0,
  reflections: [],

  // Ray trace cache
  rayTraceCache: new Map(),

  // Multi-source/listener (Phase 7)
  sources: [],
  listeners: [],
  receivers: [],

  // Timeline markers (Phase 6)
  timelineMarkers: [],

  // Recording state (Phase 8)
  isRecording: false,
  mediaRecorder: null,

  // DOA data
  doaHistory: [],
};

/**
 * Persist current state to electron-store / config
 */
export function getSerializableState() {
  return {
    source: { ...state.source },
    listener: { ...state.listener },
    tempF: state.tempF,
    rh: state.rh,
    speedOfSound: state.speedOfSound,
    currentView: state.currentView,
    reflectionMode: state.reflectionMode,
    showWaves: state.showWaves,
    showReflections: state.showReflections,
    showPaths: state.showPaths,
    showParticles: state.showParticles,
    showDOA: state.showDOA,
    spatialAudioEnabled: state.spatialAudioEnabled,
    volume: state.volume,
    simSpeed: state.simSpeed,
    maxSimTime: state.maxSimTime,
    timelineMarkers: state.timelineMarkers,
  };
}

/**
 * Restore state from persisted config
 */
export function restoreState(config) {
  if (!config) return;
  const keys = [
    'source', 'listener', 'tempF', 'rh', 'speedOfSound',
    'currentView', 'reflectionMode', 'showWaves', 'showReflections',
    'showPaths', 'showParticles', 'showDOA', 'spatialAudioEnabled',
    'volume', 'simSpeed', 'maxSimTime', 'timelineMarkers',
  ];
  keys.forEach((key) => {
    if (config[key] !== undefined) {
      if (typeof config[key] === 'object' && !Array.isArray(config[key])) {
        state[key] = { ...state[key], ...config[key] };
      } else {
        state[key] = config[key];
      }
    }
  });
}
