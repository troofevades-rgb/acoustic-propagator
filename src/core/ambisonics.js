/**
 * Ambisonics B-format processing
 * Computes intensity vectors and direction-of-arrival (DOA) from 4-channel AmbiX (ACN/SN3D)
 *
 * AmbiX (ACN) channel ordering: ch0=W, ch1=Y, ch2=Z, ch3=X
 * This is what iPhones and most modern spatial audio recorders produce.
 * FuMa ordering (W,X,Y,Z) is legacy and NOT used here.
 */

/**
 * Compute instantaneous intensity vector from B-format channels
 * @param {Float32Array[]} channels - [W, Y, Z, X] arrays (AmbiX/ACN order)
 * @param {number} sampleIndex - sample position
 * @param {number} windowSize - number of samples for averaging
 * @returns {{ azimuth: number, elevation: number, energy: number }}
 */
export function computeDOA(channels, sampleIndex, windowSize = 512) {
  if (channels.length < 4) return null;

  // AmbiX (ACN) ordering: ch0=W, ch1=Y, ch2=Z, ch3=X
  const [W, Y, Z, X] = channels;
  const halfWindow = Math.floor(windowSize / 2);
  const start = Math.max(0, sampleIndex - halfWindow);
  const end = Math.min(W.length, sampleIndex + halfWindow);

  let ix = 0, iy = 0, iz = 0, energy = 0;

  for (let i = start; i < end; i++) {
    const w = W[i];
    // Intensity vector: I = W * [X, Y, Z]
    ix += w * X[i];
    iy += w * Y[i];
    iz += w * Z[i];
    energy += w * w;
  }

  const n = end - start;
  if (n === 0 || energy < 1e-10) return { azimuth: 0, elevation: 0, energy: 0 };

  ix /= n;
  iy /= n;
  iz /= n;
  energy /= n;

  const azimuth = Math.atan2(iy, ix);
  const horizontal = Math.sqrt(ix * ix + iy * iy);
  const elevation = Math.atan2(iz, horizontal);

  return {
    azimuth,      // radians, 0 = front, positive = left
    elevation,    // radians, 0 = horizontal, positive = up
    energy,       // RMS energy of W channel in window
    ix, iy, iz,   // raw intensity components
  };
}

/**
 * Compute DOA for all frames at a given analysis rate
 * @param {Float32Array[]} channels - B-format channels
 * @param {number} sampleRate - audio sample rate
 * @param {number} analysisRate - DOA computations per second (default 120)
 * @returns {Array<{ time: number, azimuth: number, elevation: number, energy: number }>}
 */
export function computeDOATrack(channels, sampleRate, analysisRate = 120) {
  if (channels.length < 4) return [];

  const hopSamples = Math.floor(sampleRate / analysisRate);
  const windowSize = hopSamples * 4; // overlap 4x
  const track = [];

  for (let sample = 0; sample < channels[0].length; sample += hopSamples) {
    const doa = computeDOA(channels, sample, windowSize);
    if (doa) {
      track.push({
        time: sample / sampleRate,
        ...doa,
      });
    }
  }

  return track;
}

/**
 * Decode B-format to stereo using basic decode matrix
 * Useful for monitoring audio output
 */
export function decodeToStereo(channels, frames) {
  if (channels.length < 4) {
    // If mono or stereo, just return as-is
    return channels.length === 1 ? [channels[0], channels[0]] : [channels[0], channels[1]];
  }

  // AmbiX (ACN) ordering: ch0=W, ch1=Y, ch2=Z, ch3=X
  const W = channels[0];
  const Y = channels[1];
  // channels[2] is Z (up-down), not used for stereo decode
  const X = channels.length >= 4 ? channels[3] : new Float32Array(frames);
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);

  // Cardioid stereo decode: L = W + 0.5*X + 0.5*Y, R = W + 0.5*X - 0.5*Y
  const sqrt2 = Math.SQRT2;
  for (let i = 0; i < frames; i++) {
    left[i] = (W[i] + 0.5 * X[i] + 0.5 * Y[i]) / sqrt2;
    right[i] = (W[i] + 0.5 * X[i] - 0.5 * Y[i]) / sqrt2;
  }

  return [left, right];
}
