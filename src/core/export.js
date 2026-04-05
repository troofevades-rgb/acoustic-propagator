/**
 * Export utilities: session save/load, screenshot, video recording
 */

import { state, getSerializableState } from './state.js';

/**
 * Export current session as a JSON object
 */
export function exportSession() {
  return {
    version: 2,
    timestamp: new Date().toISOString(),
    ...getSerializableState(),
    sources: state.sources.map((s) => ({
      pos: s.pos,
      color: s.color,
      wavPath: s.wavPath,
    })),
    listeners: state.listeners.map((l) => ({
      pos: l.pos,
      color: l.color,
    })),
    receivers: state.receivers.map((r) => ({
      name: r.name,
      lat: r.lat,
      lon: r.lon,
      height: r.height,
    })),
  };
}

/**
 * Capture screenshot from the Cesium canvas
 */
export function captureScreenshot(viewer) {
  viewer.render();
  return viewer.scene.canvas.toDataURL('image/png');
}

/**
 * Start recording video from the Cesium canvas
 * Returns a MediaRecorder instance
 */
export function startRecording(viewer, audioCtx, audioDestination) {
  const canvas = viewer.scene.canvas;
  const videoStream = canvas.captureStream(60);

  // Mix in audio if available
  if (audioCtx && audioDestination) {
    const audioStream = audioCtx.createMediaStreamDestination();
    audioDestination.connect(audioStream);
    audioStream.stream.getAudioTracks().forEach((track) => {
      videoStream.addTrack(track);
    });
  }

  // Prefer WebM VP9 for quality
  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ? 'video/webm;codecs=vp9'
    : 'video/webm';

  const recorder = new MediaRecorder(videoStream, {
    mimeType,
    videoBitsPerSecond: 8000000, // 8 Mbps
  });

  const chunks = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: mimeType });
    const url = URL.createObjectURL(blob);

    // Trigger download
    const a = document.createElement('a');
    a.href = url;
    a.download = `acoustic-propagator-${Date.now()}.webm`;
    a.click();

    setTimeout(() => URL.revokeObjectURL(url), 30000);
  };

  recorder.start(100); // 100ms chunks
  state.isRecording = true;
  state.mediaRecorder = recorder;

  return recorder;
}

/**
 * Export DOA track data as CSV or JSON and trigger a download.
 * @param {Array} doaTrack — array of DOA frame objects from computeDOATrack
 * @param {'csv'|'json'} format — output format
 */
export async function exportDOATrack(doaTrack, format = 'csv') {
  if (!doaTrack || doaTrack.length === 0) {
    console.warn('[EXPORT] No DOA track data to export');
    return;
  }

  let blob, filename;

  if (format === 'json') {
    const json = JSON.stringify(doaTrack, null, 2);
    blob = new Blob([json], { type: 'application/json' });
    filename = `doa-track-${Date.now()}.json`;
  } else {
    // CSV
    const headers = [
      'time_s', 'azimuth_deg', 'elevation_deg', 'energy',
      'compass_bearing', 'onset',
      'band_low_az', 'band_mid_az', 'band_high_az',
    ];
    const lines = [headers.join(',')];

    for (const frame of doaTrack) {
      const azDeg = (frame.azimuth * 180 / Math.PI).toFixed(4);
      const elDeg = (frame.elevation * 180 / Math.PI).toFixed(4);
      const energy = frame.energy.toExponential(6);
      const compass = frame.compass != null ? frame.compass.toFixed(2) : '';
      const onset = frame.onset ? '1' : '0';

      let bandLowAz = '', bandMidAz = '', bandHighAz = '';
      if (frame.bands) {
        if (frame.bands.low) bandLowAz = (frame.bands.low.azimuth * 180 / Math.PI).toFixed(4);
        if (frame.bands.mid) bandMidAz = (frame.bands.mid.azimuth * 180 / Math.PI).toFixed(4);
        if (frame.bands.high) bandHighAz = (frame.bands.high.azimuth * 180 / Math.PI).toFixed(4);
      }

      lines.push([
        frame.time.toFixed(6), azDeg, elDeg, energy,
        compass, onset,
        bandLowAz, bandMidAz, bandHighAz,
      ].join(','));
    }

    blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    filename = `doa-track-${Date.now()}.csv`;
  }

  // Use Electron save dialog if available, otherwise browser download
  if (window.electronAPI) {
    try {
      const text = await blob.text();
      const data = format === 'json'
        ? JSON.parse(text)
        : text;
      await window.electronAPI.saveSession(data);
      return;
    } catch (e) {
      console.warn('[EXPORT] Electron save failed, falling back to browser download:', e);
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/**
 * Stop video recording
 */
export function stopRecording() {
  if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
    state.mediaRecorder.stop();
  }
  state.isRecording = false;
  state.mediaRecorder = null;
}
