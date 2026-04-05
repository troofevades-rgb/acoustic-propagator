/**
 * DOA Web Worker — runs computeDOATrack off the main thread.
 *
 * Receives via postMessage:
 *   { channels: Float32Array[], sampleRate, analysisRate, headingTrack, calPoints }
 *
 * Posts back:
 *   { type: 'progress', percent }
 *   { type: 'done', track }
 *   { type: 'error', message }
 *
 * Channel buffers are transferred (zero-copy) via Transferable ArrayBuffers.
 */

// ─── 2nd-order Butterworth biquad filters (12dB/octave) ───
// Robert Bristow-Johnson Audio EQ Cookbook, Q = 1/sqrt(2)

function highpass(input, sr, freq) {
  const out = new Float32Array(input.length);
  const Q = Math.SQRT1_2;
  const w0 = 2 * Math.PI * freq / sr;
  const cosw0 = Math.cos(w0);
  const sinw0 = Math.sin(w0);
  const alpha = sinw0 / (2 * Q);

  const b0 = (1 + cosw0) / 2;
  const b1 = -(1 + cosw0);
  const b2 = (1 + cosw0) / 2;
  const a0 = 1 + alpha;
  const a1 = -2 * cosw0;
  const a2 = 1 - alpha;

  const nb0 = b0 / a0, nb1 = b1 / a0, nb2 = b2 / a0;
  const na1 = a1 / a0, na2 = a2 / a0;

  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x0 = input[i];
    out[i] = nb0 * x0 + nb1 * x1 + nb2 * x2 - na1 * y1 - na2 * y2;
    x2 = x1; x1 = x0;
    y2 = y1; y1 = out[i];
  }
  return out;
}

function lowpass(input, sr, freq) {
  const out = new Float32Array(input.length);
  const Q = Math.SQRT1_2;
  const w0 = 2 * Math.PI * freq / sr;
  const cosw0 = Math.cos(w0);
  const sinw0 = Math.sin(w0);
  const alpha = sinw0 / (2 * Q);

  const b0 = (1 - cosw0) / 2;
  const b1 = 1 - cosw0;
  const b2 = (1 - cosw0) / 2;
  const a0 = 1 + alpha;
  const a1 = -2 * cosw0;
  const a2 = 1 - alpha;

  const nb0 = b0 / a0, nb1 = b1 / a0, nb2 = b2 / a0;
  const na1 = a1 / a0, na2 = a2 / a0;

  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x0 = input[i];
    out[i] = nb0 * x0 + nb1 * x1 + nb2 * x2 - na1 * y1 - na2 * y2;
    x2 = x1; x1 = x0;
    y2 = y1; y1 = out[i];
  }
  return out;
}

function bandpass(input, sr, lo, hi) {
  return lowpass(highpass(input, sr, lo), sr, hi);
}

// ─── Heading / compass (self-contained copies for worker context) ───

let headingTrack = [];
let calPoints = [];
let gyroAtCal0 = null;
let gyroAtCal1 = null;
let driftOffset0 = 0;
let driftOffset1 = 0;
let driftInited = false;

function lookupGyroRaw(time) {
  const track = headingTrack;
  if (track.length === 0) return 0;
  if (time <= track[0][0]) return track[0][1] * 180 / Math.PI;
  if (time >= track[track.length - 1][0]) return track[track.length - 1][1] * 180 / Math.PI;

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

  let diff = h1 - h0;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  return h0 + diff * frac;
}

function initDrift() {
  if (driftInited || headingTrack.length === 0 || calPoints.length < 2) return;
  gyroAtCal0 = lookupGyroRaw(calPoints[0].time);
  gyroAtCal1 = lookupGyroRaw(calPoints[1].time);
  driftOffset0 = calPoints[0].heading - gyroAtCal0;
  driftOffset1 = calPoints[1].heading - gyroAtCal1;

  while (driftOffset1 - driftOffset0 > 180) driftOffset1 -= 360;
  while (driftOffset1 - driftOffset0 < -180) driftOffset1 += 360;

  driftInited = true;
}

function getHeadingAtTime(time) {
  initDrift();
  if (headingTrack.length === 0) return calPoints.length > 0 ? calPoints[0].heading : 0;

  const gyroNow = lookupGyroRaw(time);

  let offset;
  if (calPoints.length < 2) {
    offset = driftOffset0;
  } else if (time <= calPoints[0].time) {
    offset = driftOffset0;
  } else if (time >= calPoints[1].time) {
    offset = driftOffset1;
  } else {
    const frac = (time - calPoints[0].time) / (calPoints[1].time - calPoints[0].time);
    offset = driftOffset0 + frac * (driftOffset1 - driftOffset0);
  }

  return ((gyroNow + offset) % 360 + 360) % 360;
}

function ambiXToCompass(azimuthRad, time) {
  const heading = getHeadingAtTime(time);
  const azDeg = azimuthRad * 180 / Math.PI;
  return ((heading + azDeg) % 360 + 360) % 360;
}

// ─── DOA computation ───

function computeDOA(channels, sampleIndex, windowSize) {
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

// ─── Band definitions ───
const BANDS = {
  low:  { lo: 80,   hi: 500 },
  mid:  { lo: 500,  hi: 3000 },
  high: { lo: 3000, hi: 10000 },
};

// ─── Main worker entry point ───

self.onmessage = function(e) {
  try {
    const { channels, sampleRate, analysisRate, headingTrackData, calPointsData } = e.data;

    // Initialize heading data
    headingTrack = headingTrackData || [];
    calPoints = calPointsData || [];
    driftInited = false;

    // Reconstruct Float32Arrays from transferred buffers
    const chArrays = channels.map(buf => new Float32Array(buf));

    const result = computeDOATrackWorker(chArrays, sampleRate, analysisRate || 200);
    self.postMessage({ type: 'done', track: result });
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message || String(err) });
  }
};

function computeDOATrackWorker(channels, sampleRate, analysisRate) {
  if (channels.length < 4) return [];

  // Step 1: 80Hz high-pass on all channels
  self.postMessage({ type: 'progress', percent: 0, stage: 'Applying 80Hz high-pass filter' });
  const hp = channels.map(ch => highpass(ch, sampleRate, 80));

  // Step 2: Primary DOA at analysisRate fps
  self.postMessage({ type: 'progress', percent: 10, stage: 'Computing primary DOA track' });
  const hopSamples = Math.floor(sampleRate / analysisRate);
  const windowSize = hopSamples * 4;
  const track = [];
  const totalSamples = hp[0].length;

  for (let sample = 0; sample < totalSamples; sample += hopSamples) {
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

    // Progress updates every ~5%
    const pct = 10 + (sample / totalSamples) * 30;
    if (sample % (hopSamples * 200) === 0) {
      self.postMessage({ type: 'progress', percent: Math.round(pct), stage: 'Computing primary DOA track' });
    }
  }

  // Step 3: Onset detection
  self.postMessage({ type: 'progress', percent: 40, stage: 'Detecting onsets' });
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

  const onsets = [];
  const ONSET_THRESHOLD = 0.15;
  const ONSET_MIN_GAP_MS = 300;
  let lastOnsetSample = -sampleRate;
  for (let i = 1; i < energyEnv.length; i++) {
    const jump = energyEnv[i].rms - energyEnv[i - 1].rms;
    if (jump > ONSET_THRESHOLD && (energyEnv[i].sample - lastOnsetSample) > sampleRate * ONSET_MIN_GAP_MS / 1000) {
      onsets.push(energyEnv[i].sample);
      lastOnsetSample = energyEnv[i].sample;
    }
  }

  self.postMessage({ type: 'progress', percent: 50, stage: `Found ${onsets.length} onsets` });

  // Step 4: High-res multi-band analysis around each onset
  if (onsets.length > 0) {
    self.postMessage({ type: 'progress', percent: 55, stage: 'Band-pass filtering for transient analysis' });
    const bandChannels = {};
    for (const [name, band] of Object.entries(BANDS)) {
      bandChannels[name] = channels.map(ch => bandpass(ch, sampleRate, band.lo, band.hi));
    }

    const hiResHop = Math.floor(sampleRate / 1000);
    const hiResWindowLow  = Math.floor(sampleRate * 0.010);
    const hiResWindowMid  = Math.floor(sampleRate * 0.005);
    const hiResWindowHigh = Math.floor(sampleRate * 0.002);

    for (let oi = 0; oi < onsets.length; oi++) {
      const onsetSample = onsets[oi];
      const marginSamples = Math.floor(sampleRate * 0.050);
      const regionStart = Math.max(0, onsetSample - marginSamples);
      const regionEnd = Math.min(hp[0].length, onsetSample + marginSamples);
      const onsetTime = onsetSample / sampleRate;

      for (let s = regionStart; s < regionEnd; s += hiResHop) {
        const time = s / sampleRate;
        const raw = computeDOA(hp, s, Math.floor(sampleRate * 0.003));
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
          onset: Math.abs(time - onsetTime) < 0.005,
          bands: {
            low: low ? { azimuth: low.azimuth, compass: ambiXToCompass(low.azimuth, time), energy: low.energy } : null,
            mid: mid ? { azimuth: mid.azimuth, compass: ambiXToCompass(mid.azimuth, time), energy: mid.energy } : null,
            high: high ? { azimuth: high.azimuth, compass: ambiXToCompass(high.azimuth, time), energy: high.energy } : null,
          },
        });
      }

      // Progress per onset
      const pct = 60 + (oi / onsets.length) * 35;
      self.postMessage({ type: 'progress', percent: Math.round(pct), stage: `Analyzing onset ${oi + 1}/${onsets.length}` });
    }

    // Sort by time
    track.sort((a, b) => a.time - b.time);
  }

  self.postMessage({ type: 'progress', percent: 100, stage: 'Complete' });
  return track;
}
