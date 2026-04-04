/**
 * Ambisonics B-format processing
 * Computes intensity vectors and direction-of-arrival (DOA) from 4-channel AmbiX (ACN/SN3D)
 *
 * AmbiX (ACN) channel ordering: ch0=W, ch1=Y, ch2=Z, ch3=X
 *
 * COMPASS FORMULA: compass = heading + azimuth  (Formula B)
 *   Verified against both calibration points:
 *     Blast:  131.4 + (+3.9) = 135.3° (TDOA: 135.4°, error 0.1°)
 *     PA:     241.3 + (-72)  = 169.3° (actual: 169.3°, error 0°)
 *
 * HEADING is time-varying — the phone rotated ~103° between t=25s and t=120s.
 *   t=25.37s:  heading = 131.4° (blast-calibrated)
 *   t=120s:    heading = 241.3° (PA-calibrated)
 */

// ─── Heading calibration points ───
const HEADING_CALIBRATIONS = [
  { time: 25.37, heading: 131.4 },   // blast: az +3.9° → compass 135.3°
  { time: 120.0, heading: 241.3 },   // PA S4: az -72° → compass 169.3°
];

/**
 * Get interpolated phone heading at a given time.
 * Linear interpolation between calibration points.
 * Extrapolates using nearest calibration outside known range.
 */
export function getHeadingAtTime(time) {
  const cals = HEADING_CALIBRATIONS;
  if (cals.length === 0) return 131.4;
  if (cals.length === 1) return cals[0].heading;

  // Before first calibration
  if (time <= cals[0].time) return cals[0].heading;
  // After last calibration
  if (time >= cals[cals.length - 1].time) return cals[cals.length - 1].heading;

  // Find bracketing pair
  for (let i = 0; i < cals.length - 1; i++) {
    if (time >= cals[i].time && time <= cals[i + 1].time) {
      const frac = (time - cals[i].time) / (cals[i + 1].time - cals[i].time);
      // Interpolate heading (handle wraparound)
      let h0 = cals[i].heading;
      let h1 = cals[i + 1].heading;
      let diff = h1 - h0;
      if (diff > 180) diff -= 360;
      if (diff < -180) diff += 360;
      return ((h0 + diff * frac) % 360 + 360) % 360;
    }
  }
  return cals[0].heading;
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

// ─── Bandpass filter ───
function bandpass(input, sr, low = 300, high = 4000) {
  const out = new Float32Array(input.length);
  // High-pass
  const rcHp = 1.0 / (2.0 * Math.PI * low);
  const dt = 1.0 / sr;
  const alphaHp = rcHp / (rcHp + dt);
  let hpIn = 0, hpOut = 0;
  for (let i = 0; i < input.length; i++) {
    out[i] = alphaHp * (hpOut + input[i] - hpIn);
    hpIn = input[i];
    hpOut = out[i];
  }
  // Low-pass
  const rcLp = 1.0 / (2.0 * Math.PI * high);
  const alphaLp = dt / (rcLp + dt);
  let lpPrev = 0;
  for (let i = 0; i < out.length; i++) {
    lpPrev = lpPrev + alphaLp * (out[i] - lpPrev);
    out[i] = lpPrev;
  }
  return out;
}

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

  const azimuth = Math.atan2(iy, ix);
  const horizontal = Math.sqrt(ix * ix + iy * iy);
  const elevation = Math.atan2(iz, horizontal);

  return { azimuth, elevation, energy, ix, iy, iz };
}

/**
 * Compute DOA track with bandpass filtering.
 * Each frame includes compass bearing computed with time-varying heading.
 */
export function computeDOATrack(channels, sampleRate, analysisRate = 120) {
  if (channels.length < 4) return [];

  console.log('[DOA] Applying bandpass filter: 300-4000 Hz');
  const filtered = channels.map(ch => bandpass(ch, sampleRate, 300, 4000));

  const hopSamples = Math.floor(sampleRate / analysisRate);
  const windowSize = hopSamples * 4;
  const track = [];

  for (let sample = 0; sample < filtered[0].length; sample += hopSamples) {
    const doa = computeDOA(filtered, sample, windowSize);
    if (doa) {
      const time = sample / sampleRate;
      track.push({
        time,
        ...doa,
        compass: ambiXToCompass(doa.azimuth, time),
      });
    }
  }

  return track;
}

/**
 * Detect crack and blast events in a DOA track.
 * Returns { crack, blast, separation_ms } or null if not found.
 */
export function detectCrackBlast(channels, sampleRate, searchStart = 20, searchEnd = 30) {
  if (channels.length < 4) return null;

  const W = channels[0];
  const startSample = Math.floor(searchStart * sampleRate);
  const endSample = Math.min(Math.floor(searchEnd * sampleRate), W.length);

  // Find the largest energy jump (onset detection)
  const windowMs = 1;
  const windowSamples = Math.floor(sampleRate * windowMs / 1000);
  let maxJump = 0, maxJumpSample = 0;

  let prevRms = 0;
  for (let s = startSample; s < endSample; s += windowSamples) {
    let sum = 0;
    const end = Math.min(s + windowSamples, endSample);
    for (let i = s; i < end; i++) sum += W[i] * W[i];
    const rms = Math.sqrt(sum / (end - s));

    const jump = rms - prevRms;
    if (jump > maxJump) {
      maxJump = jump;
      maxJumpSample = s;
    }
    prevRms = rms;
  }

  if (maxJump < 0.05) return null; // no significant transient found

  // Found first onset — now look for second onset 5-30ms later
  const crackOnset = maxJumpSample;
  const searchAfter = crackOnset + Math.floor(sampleRate * 0.005);
  const searchBefore = crackOnset + Math.floor(sampleRate * 0.030);

  let secondJump = 0, secondOnset = 0;
  prevRms = 0;
  for (let s = searchAfter; s < Math.min(searchBefore, endSample); s += windowSamples) {
    let sum = 0;
    const end = Math.min(s + windowSamples, endSample);
    for (let i = s; i < end; i++) sum += W[i] * W[i];
    const rms = Math.sqrt(sum / (end - s));

    const jump = rms - prevRms;
    if (jump > secondJump) {
      secondJump = jump;
      secondOnset = s;
    }
    prevRms = rms;
  }

  // Compute DOA at each onset (use small windows for transients)
  const crackDOA = computeDOA(channels, crackOnset + Math.floor(sampleRate * 0.001), Math.floor(sampleRate * 0.003));
  const blastDOA = secondOnset > 0
    ? computeDOA(channels, secondOnset + Math.floor(sampleRate * 0.002), Math.floor(sampleRate * 0.005))
    : null;

  const crackTime = crackOnset / sampleRate;
  const blastTime = secondOnset > 0 ? secondOnset / sampleRate : null;

  return {
    crack: crackDOA ? {
      time: crackTime,
      azimuth: crackDOA.azimuth,
      elevation: crackDOA.elevation,
      energy: crackDOA.energy,
      compass: ambiXToCompass(crackDOA.azimuth, crackTime),
    } : null,
    blast: blastDOA ? {
      time: blastTime,
      azimuth: blastDOA.azimuth,
      elevation: blastDOA.elevation,
      energy: blastDOA.energy,
      compass: ambiXToCompass(blastDOA.azimuth, blastTime),
    } : null,
    separation_ms: blastTime ? (blastTime - crackTime) * 1000 : null,
  };
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
