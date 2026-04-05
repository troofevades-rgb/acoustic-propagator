/**
 * TDOA (Time Difference of Arrival) module
 *
 * Provides cross-correlation between two microphone signals to estimate the
 * time delay, and converts that delay into a spatial hyperbola in lat/lon
 * coordinates for multilateration.
 */

/**
 * Compute normalized cross-correlation between two signals.
 *
 * @param {Float32Array} signal1 - First signal
 * @param {Float32Array} signal2 - Second signal
 * @param {number} maxLagSamples - Maximum lag (in samples) to search in each direction
 * @returns {{ lag: number, correlation: number }} - Lag of peak (positive = signal2 leads)
 *   and the normalized correlation value at that lag.
 */
export function crossCorrelate(signal1, signal2, maxLagSamples) {
  const N = Math.min(signal1.length, signal2.length);
  if (N === 0) return { lag: 0, correlation: 0 };

  // Compute energies for normalization
  let energy1 = 0, energy2 = 0;
  for (let i = 0; i < N; i++) {
    energy1 += signal1[i] * signal1[i];
    energy2 += signal2[i] * signal2[i];
  }
  const normFactor = Math.sqrt(energy1 * energy2);
  if (normFactor < 1e-20) return { lag: 0, correlation: 0 };

  let bestLag = 0;
  let bestCorr = -Infinity;

  for (let lag = -maxLagSamples; lag <= maxLagSamples; lag++) {
    let sum = 0;
    const start = Math.max(0, lag);
    const end = Math.min(N, N + lag);
    for (let i = start; i < end; i++) {
      sum += signal1[i] * signal2[i - lag];
    }
    const corr = sum / normFactor;
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }

  return { lag: bestLag, correlation: bestCorr };
}

/**
 * Compute TDOA in seconds between two signals.
 *
 * @param {Float32Array} signal1 - Signal from mic 1
 * @param {Float32Array} signal2 - Signal from mic 2
 * @param {number} sampleRate - Sample rate in Hz
 * @param {number} [maxLagMs=50] - Maximum lag to search in milliseconds
 * @returns {{ tdoa: number, correlation: number }} - TDOA in seconds (positive = signal arrives
 *   at mic1 first), and correlation confidence.
 */
export function computeTDOA(signal1, signal2, sampleRate, maxLagMs = 50) {
  const maxLagSamples = Math.ceil(sampleRate * maxLagMs / 1000);
  const { lag, correlation } = crossCorrelate(signal1, signal2, maxLagSamples);
  return {
    tdoa: lag / sampleRate,
    correlation,
  };
}

/**
 * Given two mic positions and a TDOA value, compute points along the
 * TDOA hyperbola in lat/lon coordinates.
 *
 * The hyperbola is the locus of points where the difference in distances
 * to the two mics equals tdoa * speedOfSound.
 *
 * Uses the standard parametric hyperbola formula in the rotated frame
 * of the mic pair baseline:
 *   x = a * cosh(t)
 *   y = b * sinh(t)
 * where a = |tdoa * c| / 2 (semi-transverse axis) and
 *       b = sqrt((d/2)^2 - a^2) (semi-conjugate axis),
 *       d = distance between mics.
 *
 * @param {{ lat: number, lon: number }} mic1 - First mic position
 * @param {{ lat: number, lon: number }} mic2 - Second mic position
 * @param {number} tdoa - Time difference of arrival in seconds (positive = closer to mic1)
 * @param {number} speedOfSound - Speed of sound in m/s
 * @param {number} [numPoints=100] - Number of points to sample along the hyperbola
 * @returns {Array<{ lat: number, lon: number }>} - Points along the hyperbola branch
 */
export function tdoaToHyperbola(mic1, mic2, tdoa, speedOfSound, numPoints = 100) {
  // Earth conversion constants (approximate, valid near the mic positions)
  const latCenter = (mic1.lat + mic2.lat) / 2;
  const lonCenter = (mic1.lon + mic2.lon) / 2;
  const metersPerDegLat = 111320;
  const metersPerDegLon = 111320 * Math.cos(latCenter * Math.PI / 180);

  // Convert mic positions to local meters relative to center
  const m1x = (mic1.lon - lonCenter) * metersPerDegLon;
  const m1y = (mic1.lat - latCenter) * metersPerDegLat;
  const m2x = (mic2.lon - lonCenter) * metersPerDegLon;
  const m2y = (mic2.lat - latCenter) * metersPerDegLat;

  // Baseline vector and distance
  const dx = m2x - m1x;
  const dy = m2y - m1y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < 1e-6) return [];

  // Rotation angle of the baseline
  const theta = Math.atan2(dy, dx);
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);

  // Center of the baseline (origin in local frame)
  const cx = (m1x + m2x) / 2;
  const cy = (m1y + m2y) / 2;

  // Hyperbola parameters
  const rangeDiff = Math.abs(tdoa) * speedOfSound;
  const a = rangeDiff / 2; // semi-transverse axis
  const halfD = d / 2;

  // If a >= halfD, the TDOA is physically impossible (speed of sound violation)
  if (a >= halfD) return [];

  const b = Math.sqrt(halfD * halfD - a * a); // semi-conjugate axis

  // Determine which branch: positive tdoa means closer to mic1,
  // so the source is on the mic1 side (negative x in baseline frame)
  const sign = tdoa >= 0 ? -1 : 1;

  // Parametric sampling: t ranges from -tMax to +tMax
  const tMax = 3.0; // controls how far the hyperbola extends
  const points = [];

  for (let i = 0; i < numPoints; i++) {
    const t = -tMax + (2 * tMax * i) / (numPoints - 1);
    const hx = sign * a * Math.cosh(t);
    const hy = b * Math.sinh(t);

    // Rotate back to local frame and translate to center
    const lx = cx + hx * cosT - hy * sinT;
    const ly = cy + hx * sinT + hy * cosT;

    // Convert back to lat/lon
    points.push({
      lat: latCenter + ly / metersPerDegLat,
      lon: lonCenter + lx / metersPerDegLon,
    });
  }

  return points;
}
