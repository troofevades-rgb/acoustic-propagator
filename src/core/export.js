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
 * Stop video recording
 */
export function stopRecording() {
  if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
    state.mediaRecorder.stop();
  }
  state.isRecording = false;
  state.mediaRecorder = null;
}
