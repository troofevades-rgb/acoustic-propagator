/**
 * Spatial Audio Engine — Listener-centric
 *
 * The loaded WAV is the recording itself (potentially B-format ambisonics).
 * We decode it for playback and analyze it for DOA.
 * No synthetic source positioning — the audio IS the evidence.
 *
 * Playback modes:
 * - Mono/Stereo: play directly through stereo output
 * - 4-channel B-format: decode to binaural stereo using cardioid decode
 *
 * The engine provides play/pause/seek with a current playback time
 * that syncs to the timeline and DOA analysis.
 */

import { decodeToStereo } from './ambisonics.js';

export class SpatialAudioEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.activeSource = null;
    this.playbackBuffer = null;    // stereo AudioBuffer for playback
    this.rawBuffer = null;         // original AudioBuffer (all channels)
    this.startTime = 0;            // ctx.currentTime when playback started
    this.startOffset = 0;          // offset into the buffer (for seek)
    this.isPlaying = false;
    this.duration = 0;
    this.onEndedCallback = null;
  }

  init() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: 48000,
    });
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.8;
    this.masterGain.connect(this.ctx.destination);
  }

  /**
   * Load parsed WAV data into the engine.
   * Creates both the raw buffer (for analysis) and a stereo decode (for playback).
   */
  loadWav(wavData) {
    if (!this.ctx) this.init();

    const { channels, sampleRate, frames, numChannels } = wavData;

    // Store raw buffer with all channels
    this.rawBuffer = this.ctx.createBuffer(numChannels, frames, sampleRate);
    for (let c = 0; c < numChannels; c++) {
      this.rawBuffer.copyToChannel(channels[c], c);
    }

    // Create stereo playback buffer
    // For B-format (4ch), decode to binaural stereo
    // For mono/stereo, just use as-is
    const stereo = decodeToStereo(channels, frames);
    this.playbackBuffer = this.ctx.createBuffer(2, frames, sampleRate);
    this.playbackBuffer.copyToChannel(stereo[0], 0);
    this.playbackBuffer.copyToChannel(stereo[1], 1);

    this.duration = frames / sampleRate;
    this.startOffset = 0;

    return this.duration;
  }

  /**
   * Start or resume playback from the current offset
   */
  async play(offset) {
    if (!this.ctx || !this.playbackBuffer) return;

    // Resume AudioContext if suspended (browser autoplay policy)
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    this.stop();

    if (offset !== undefined) {
      this.startOffset = Math.max(0, Math.min(offset, this.duration));
    }

    const source = this.ctx.createBufferSource();
    source.buffer = this.playbackBuffer;
    source.connect(this.masterGain);

    source.onended = () => {
      if (this.isPlaying) {
        this.isPlaying = false;
        this.startOffset = this.duration;
        if (this.onEndedCallback) this.onEndedCallback();
      }
    };

    source.start(0, this.startOffset);
    this.startTime = this.ctx.currentTime;
    this.activeSource = source;
    this.isPlaying = true;
  }

  /**
   * Pause playback, remembering position
   */
  pause() {
    if (!this.isPlaying) return;
    this.startOffset = this.getCurrentTime();
    this.stop();
  }

  /**
   * Stop playback
   */
  stop() {
    if (this.activeSource) {
      try { this.activeSource.stop(); } catch (e) { /* already stopped */ }
      this.activeSource = null;
    }
    this.isPlaying = false;
  }

  /**
   * Seek to a specific time (seconds)
   */
  seek(time) {
    const wasPlaying = this.isPlaying;
    this.stop();
    this.startOffset = Math.max(0, Math.min(time, this.duration));
    if (wasPlaying) {
      this.play();
    }
  }

  /**
   * Get current playback time in seconds
   */
  getCurrentTime() {
    if (!this.isPlaying || !this.ctx) return this.startOffset;
    const elapsed = this.ctx.currentTime - this.startTime;
    return Math.min(this.startOffset + elapsed, this.duration);
  }

  /**
   * Set master volume (0-1)
   */
  setVolume(vol) {
    if (this.masterGain) {
      this.masterGain.gain.value = Math.max(0, Math.min(1, vol));
    }
  }

  /**
   * Get the AudioContext for external use (e.g., media recording)
   */
  getContext() {
    if (!this.ctx) this.init();
    return this.ctx;
  }

  /**
   * Get the master gain node for recording
   */
  getDestination() {
    return this.masterGain;
  }
}
