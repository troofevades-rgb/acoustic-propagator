/**
 * Ambisonics B-format processing
 * Computes intensity vectors and direction-of-arrival (DOA) from 4-channel AmbiX (ACN/SN3D)
 *
 * AmbiX (ACN) channel ordering: ch0=W, ch1=Y, ch2=Z, ch3=X
 *
 * COMPASS FORMULA: compass = heading + azimuth  (Formula B)
 *
 * HEADING: 4838-frame gyro track from APAC metadata (~30fps), drift-corrected
 * using two ground-truth calibration points:
 *   t=25.37s: blast → TDOA muzzle at 135.4° → heading = 131.4°
 *   t=120.0s: PA S4 → known at 169.3°        → heading = 241.3°
 *
 * The gyro track captures real phone movements (rotations, handling) at ~33ms
 * resolution. The drift correction linearly interpolates the offset between
 * gyro heading and calibrated heading, keeping absolute accuracy while
 * preserving frame-to-frame fidelity.
 */

import { HEADING_TRACK } from './heading-track.js';

// ─── Calibration anchors (ground truth) ───
const CAL_POINTS = [
  { time: 25.37, heading: 131.4 },   // blast: az +3.9° → compass 135.3°
  { time: 120.0, heading: 241.3 },   // PA S4: az -72° → compass 169.3°
];

// ─── Pre-compute gyro heading at calibration times for drift correction ───
let gyroAtCal0 = null;
let gyroAtCal1 = null;
let driftOffset0 = 0;
let driftOffset1 = 0;
let driftInited = false;

function initDrift() {
  if (driftInited || HEADING_TRACK.length === 0) return;
  gyroAtCal0 = lookupGyroRaw(CAL_POINTS[0].time);
  gyroAtCal1 = lookupGyroRaw(CAL_POINTS[1].time);
  driftOffset0 = CAL_POINTS[0].heading - gyroAtCal0;
  driftOffset1 = CAL_POINTS[1].heading - gyroAtCal1;

  // Normalize offsets to avoid wraparound artifacts
  while (driftOffset1 - driftOffset0 > 180) driftOffset1 -= 360;
  while (driftOffset1 - driftOffset0 < -180) driftOffset1 += 360;

  driftInited = true;
  console.log(`[HEADING] Drift correction initialized:`);
  console.log(`  Cal0 t=${CAL_POINTS[0].time}s: gyro=${gyroAtCal0.toFixed(1)}° → cal=${CAL_POINTS[0].heading}° (offset=${driftOffset0.toFixed(1)}°)`);
  console.log(`  Cal1 t=${CAL_POINTS[1].time}s: gyro=${gyroAtCal1.toFixed(1)}° → cal=${CAL_POINTS[1].heading}° (offset=${driftOffset1.toFixed(1)}°)`);
  console.log(`  Drift rate: ${((driftOffset1 - driftOffset0) / (CAL_POINTS[1].time - CAL_POINTS[0].time)).toFixed(3)}°/s`);
  console.log(`  Track: ${HEADING_TRACK.length} frames, ${HEADING_TRACK[0][0].toFixed(2)}s – ${HEADING_TRACK[HEADING_TRACK.length-1][0].toFixed(2)}s`);
}

/**
 * Look up raw gyro heading (degrees) at a given time via binary search + lerp.
 */
function lookupGyroRaw(time) {
  const track = HEADING_TRACK;
  if (track.length === 0) return 0;
  if (time <= track[0][0]) return track[0][1] * 180 / Math.PI;
  if (time >= track[track.length - 1][0]) return track[track.length - 1][1] * 180 / Math.PI;

  // Binary search for bracketing frames
  let lo = 0, hi = track.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (track[mid][0] <= time) lo = mid;
    else hi = mid;
  }

  const t0 = track[lo][0], t1 = track[hi][0];
  const h0 = track[lo][1] * 180 / Math.PI;
  const h1 = track[hi][1] * 180 / Math.PI;
  const frac = (time - t0) / (t1 - t0);

  // Lerp with wraparound
  let diff = h1 - h0;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  return h0 + diff * frac;
}

/**
 * Get drift-corrected heading at a given time.
 * Uses the 4838-frame gyro track for frame-accurate rotation, with a
 * linearly interpolated drift offset anchored at two calibration points.
 */
export function getHeadingAtTime(time) {
  initDrift();

  if (HEADING_TRACK.length === 0) return CAL_POINTS[0].heading;

  const gyroNow = lookupGyroRaw(time);

  // Interpolate drift offset based on time position relative to calibration points
  let offset;
  if (time <= CAL_POINTS[0].time) {
    offset = driftOffset0;
  } else if (time >= CAL_POINTS[1].time) {
    offset = driftOffset1;
  } else {
    const frac = (time - CAL_POINTS[0].time) / (CAL_POINTS[1].time - CAL_POINTS[0].time);
    offset = driftOffset0 + frac * (driftOffset1 - driftOffset0);
  }

  return ((gyroNow + offset) % 360 + 360) % 360;
}

/**
 * Convert AmbiX azimuth to compass bearing using time-varying heading.
 * Formula B: compass = heading + azimuth
 */
export function ambiXToCompass(azimuthRad, time) {
  const heading = getHeadingAtTime(time);
  const azDeg = azimuthRad * 180 / Math.PI;
  return ((heading + azDeg) % 360 + 360) % 360;
}

/**
 * Convert AmbiX azimuth to ENU direction vector using time-varying heading.
 */
export function ambiXToENU(azimuthRad, time) {
  const compassDeg = ambiXToCompass(azimuthRad, time);
  const enuAngle = (90 - compassDeg) * Math.PI / 180;
  return {
    east: Math.cos(enuAngle),
    north: Math.sin(enuAngle),
    compass: compassDeg,
  };
}

// ─── IIR filters ───
function highpass(input, sr, freq) {
  const out = new Float32Array(input.length);
  const rc = 1.0 / (2.0 * Math.PI * freq);
  const dt = 1.0 / sr;
  const alpha = rc / (rc + dt);
  let prevIn = 0, prevOut = 0;
  for (let i = 0; i < input.length; i++) {
    out[i] = alpha * (prevOut + input[i] - prevIn);
    prevIn = input[i];
    prevOut = out[i];
  }
  return out;
}

function lowpass(input, sr, freq) {
  const out = new Float32Array(input.length);
  const rc = 1.0 / (2.0 * Math.PI * freq);
  const dt = 1.0 / sr;
  const alpha = dt / (rc + dt);
  let prev = 0;
  for (let i = 0; i < input.length; i++) {
    prev += alpha * (input[i] - prev);
    out[i] = prev;
  }
  return out;
}

function bandpass(input, sr, lo, hi) {
  return lowpass(highpass(input, sr, lo), sr, hi);
}

// ─── Band definitions (for transient analysis only) ───
const BANDS = {
  low:  { lo: 80,   hi: 500,  label: 'LOW 80-500Hz' },
  mid:  { lo: 500,  hi: 3000, label: 'MID 500-3kHz' },
  high: { lo: 3000, hi: 10000, label: 'HIGH 3-10kHz' },
};

/**
 * Compute instantaneous DOA from B-format channels
 */
export function computeDOA(channels, sampleIndex, windowSize = 512) {
  if (channels.length < 4) return null;
  const [W, Y, Z, X] = channels;
  const halfWindow = Math.floor(windowSize / 2);
  const start = Math.max(0, sampleIndex - halfWindow);
  const end = Math.min(W.length, sampleIndex + halfWindow);

  let ix = 0, iy = 0, iz = 0, energy = 0;
  for (let i = start; i < end; i++) {
    const w = W[i];
    ix += w * X[i];
    iy += w * Y[i];
    iz += w * Z[i];
    energy += w * w;
  }

  const n = end - start;
  if (n === 0 || energy < 1e-10) return { azimuth: 0, elevation: 0, energy: 0 };

  ix /= n; iy /= n; iz /= n; energy /= n;

  return {
    azimuth: Math.atan2(iy, ix),
    elevation: Math.atan2(iz, Math.sqrt(ix * ix + iy * iy)),
    energy, ix, iy, iz,
  };
}

/**
 * Hybrid DOA track:
 *  1. Primary: raw audio + 80Hz high-pass at 200fps (dominant source tracking)
 *  2. Onset detection: finds energy transients in the W channel
 *  3. Transient zoom: at each detected onset, recompute per-band DOA at 1000fps
 *     in a ±50ms window — embeds high-res band data into the track
 *
 * Each frame: { time, azimuth, elevation, energy, compass, transient? }
 * Transient frames get: { ...frame, bands: { low, mid, high }, onset: true }
 */
export function computeDOATrack(channels, sampleRate, analysisRate = 200) {
  if (channels.length < 4) return [];

  // Step 1: 80Hz high-pass on all channels (remove wind/handling rumble)
  console.log('[DOA] Step 1: 80Hz high-pass on raw audio');
  const hp = channels.map(ch => highpass(ch, sampleRate, 80));

  // Step 2: Primary DOA at 200fps
  console.log('[DOA] Step 2: Primary DOA at ' + analysisRate + 'fps');
  const hopSamples = Math.floor(sampleRate / analysisRate);
  const windowSize = hopSamples * 4;
  const track = [];

  for (let sample = 0; sample < hp[0].length; sample += hopSamples) {
    const doa = computeDOA(hp, sample, windowSize);
    if (doa) {
      const time = sample / sampleRate;
      track.push({
        time,
        azimuth: doa.azimuth,
        elevation: doa.elevation,
        energy: doa.energy,
        compass: ambiXToCompass(doa.azimuth, time),
        bands: null,
        onset: false,
      });
    }
  }

  // Step 3: Onset detection — find energy transients
  console.log('[DOA] Step 3: Onset detection');
  const onsetWindowMs = 2;
  const onsetSamples = Math.floor(sampleRate * onsetWindowMs / 1000);
  const W = hp[0];
  const energyEnv = [];
  for (let s = 0; s < W.length; s += onsetSamples) {
    let sum = 0;
    const end = Math.min(s + onsetSamples, W.length);
    for (let i = s; i < end; i++) sum += W[i] * W[i];
    energyEnv.push({ sample: s, rms: Math.sqrt(sum / (end - s)) });
  }

  // Find sharp energy jumps (onset candidates)
  const onsets = [];
  const ONSET_THRESHOLD = 0.15;
  const ONSET_MIN_GAP_MS = 300;
  let lastOnsetSample = -sampleRate; // ensure first onset can fire
  for (let i = 1; i < energyEnv.length; i++) {
    const jump = energyEnv[i].rms - energyEnv[i - 1].rms;
    if (jump > ONSET_THRESHOLD && (energyEnv[i].sample - lastOnsetSample) > sampleRate * ONSET_MIN_GAP_MS / 1000) {
      onsets.push(energyEnv[i].sample);
      lastOnsetSample = energyEnv[i].sample;
    }
  }
  console.log(`[DOA] Found ${onsets.length} transient onsets`);

  // Step 4: High-res multi-band analysis around each onset (±50ms at 1000fps)
  if (onsets.length > 0) {
    console.log('[DOA] Step 4: High-res band analysis at 1000fps around onsets');
    const bandChannels = {};
    for (const [name, band] of Object.entries(BANDS)) {
      bandChannels[name] = channels.map(ch => bandpass(ch, sampleRate, band.lo, band.hi));
    }

    const hiResHop = Math.floor(sampleRate / 1000); // 1ms hop
    const hiResWindowLow  = Math.floor(sampleRate * 0.010); // 10ms for LF
    const hiResWindowMid  = Math.floor(sampleRate * 0.005); // 5ms for mid
    const hiResWindowHigh = Math.floor(sampleRate * 0.002); // 2ms for HF

    for (const onsetSample of onsets) {
      const marginSamples = Math.floor(sampleRate * 0.050); // ±50ms
      const regionStart = Math.max(0, onsetSample - marginSamples);
      const regionEnd = Math.min(hp[0].length, onsetSample + marginSamples);
      const onsetTime = onsetSample / sampleRate;

      // Insert high-res frames into the track
      for (let s = regionStart; s < regionEnd; s += hiResHop) {
        const time = s / sampleRate;
        const raw = computeDOA(hp, s, Math.floor(sampleRate * 0.003)); // 3ms window for raw
        if (!raw || raw.energy < 1e-10) continue;

        const low  = computeDOA(bandChannels.low, s, hiResWindowLow);
        const mid  = computeDOA(bandChannels.mid, s, hiResWindowMid);
        const high = computeDOA(bandChannels.high, s, hiResWindowHigh);

        track.push({
          time,
          azimuth: raw.azimuth,
          elevation: raw.elevation,
          energy: raw.energy,
          compass: ambiXToCompass(raw.azimuth, time),
          onset: Math.abs(time - onsetTime) < 0.005, // flag ±5ms from onset
          bands: {
            low: low ? { azimuth: low.azimuth, compass: ambiXToCompass(low.azimuth, time), energy: low.energy } : null,
            mid: mid ? { azimuth: mid.azimuth, compass: ambiXToCompass(mid.azimuth, time), energy: mid.energy } : null,
            high: high ? { azimuth: high.azimuth, compass: ambiXToCompass(high.azimuth, time), energy: high.energy } : null,
          },
        });
      }
    }

    // Sort by time (hi-res frames were appended out of order)
    track.sort((a, b) => a.time - b.time);

    // Log onset details
    for (const onsetSample of onsets) {
      const t = onsetSample / sampleRate;
      const nearby = track.filter(f => f.onset && Math.abs(f.time - t) < 0.005);
      if (nearby.length > 0 && nearby[0].bands) {
        const b = nearby[0].bands;
        console.log(`  Onset t=${t.toFixed(3)}s:` +
          (b.low ? ` LO=${b.low.compass.toFixed(1)}°` : '') +
          (b.mid ? ` MID=${b.mid.compass.toFixed(1)}°` : '') +
          (b.high ? ` HI=${b.high.compass.toFixed(1)}°` : ''));
      }
    }
  }

  console.log(`[DOA] Final track: ${track.length} frames (${onsets.length} transient regions at 1000fps)`);
  return track;
}

/**
 * Decode B-format to stereo for monitoring
 */
export function decodeToStereo(channels, frames) {
  if (channels.length < 4) {
    return channels.length === 1 ? [channels[0], channels[0]] : [channels[0], channels[1]];
  }

  const W = channels[0], Y = channels[1], X = channels[3];
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  const sqrt2 = Math.SQRT2;

  for (let i = 0; i < frames; i++) {
    left[i] = (W[i] + 0.5 * X[i] + 0.5 * Y[i]) / sqrt2;
    right[i] = (W[i] + 0.5 * X[i] - 0.5 * Y[i]) / sqrt2;
  }

  return [left, right];
}
