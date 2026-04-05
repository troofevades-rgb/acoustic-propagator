#!/usr/bin/env python3
"""
Monte Carlo DOA verification for APAC AmbiX recording.

Reads APAC_raw_samples.csv (AmbiX ACN/SN3D, 48 kHz) and performs
Monte Carlo analysis of direction-of-arrival using the intensity-vector
method on two events:
  - Blast event   ~t=25.37 s
  - PA speech     ~t=9.0 s

Usage:
    python analysis/monte_carlo_blast.py
"""

import os
import sys
import time as _time

# Force UTF-8 output on Windows
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
CSV_PATH = os.path.join(
    os.path.expanduser("~"), "Downloads", "APAC_raw_samples.csv"
)
SAMPLE_RATE = 48_000

# Monte Carlo parameters
N_TRIALS = 200
WIN_MIN_SAMPLES = 48       # ~1 ms
WIN_MAX_SAMPLES = 2400     # ~50 ms

# Events to analyse  (label, centre_time, mc_start, mc_end, heading_deg)
EVENTS = [
    ("Blast t=25.37 s", 25.37, 25.30, 25.50, 131.4),
    ("PA speech t=9.0 s", 9.00, 8.90, 9.10, 131.4),
]

# Read window (seconds) – we load a generous range around each event
READ_WINDOWS = [
    (25.0, 26.0),
    (8.5, 9.5),
]

# Frequency bands for per-band DOA (Hz)
FREQ_BANDS = {
    "low  (80-500 Hz)":   (80, 500),
    "mid  (500-3k Hz)":   (500, 3000),
    "high (3k-10k Hz)":   (3000, 10000),
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def read_event_window(csv_path: str, t_start: float, t_end: float) -> pd.DataFrame:
    """Read only the rows within [t_start, t_end] from the CSV.

    Uses chunked reading so we never hold the full 7.7 M-row file in memory.
    """
    chunks = []
    row_start = int(t_start * SAMPLE_RATE)
    row_end   = int(t_end * SAMPLE_RATE)
    # skiprows is 1-indexed (row 0 is header); data rows start at 1
    # We skip everything before row_start and read (row_end - row_start) rows.
    # header=0 means first row of the chunk is treated as data, so we must
    # supply names explicitly.
    cols = ["sample", "time_s", "W", "Y", "Z", "X"]
    df = pd.read_csv(
        csv_path,
        skiprows=range(1, row_start + 1),   # skip rows 1..row_start (keep header=0)
        nrows=row_end - row_start + 1,
        names=cols,
        header=0,
        dtype={c: "float64" for c in cols},
    )
    return df


def intensity_azimuth(W: np.ndarray, X: np.ndarray, Y: np.ndarray) -> float:
    """Return azimuth (degrees) from the intensity vector.

    azimuth = atan2(mean(W*Y), mean(W*X))
    Convention: 0° = front (+X), positive = left (+Y in AmbiX).
    """
    Ix = np.mean(W * X)
    Iy = np.mean(W * Y)
    return np.degrees(np.arctan2(Iy, Ix))


def intensity_elevation(W: np.ndarray, X: np.ndarray, Y: np.ndarray,
                        Z: np.ndarray) -> float:
    """Return elevation (degrees) from the intensity vector."""
    Ix = np.mean(W * X)
    Iy = np.mean(W * Y)
    Iz = np.mean(W * Z)
    horiz = np.sqrt(Ix**2 + Iy**2)
    return np.degrees(np.arctan2(Iz, horiz))


def rms_energy(W: np.ndarray) -> float:
    """RMS energy of the omni channel."""
    return np.sqrt(np.mean(W**2))


def bandpass_fft(signal: np.ndarray, f_lo: float, f_hi: float,
                 sr: int) -> np.ndarray:
    """Simple FFT brick-wall bandpass (no scipy needed)."""
    N = len(signal)
    spec = np.fft.rfft(signal)
    freqs = np.fft.rfftfreq(N, d=1.0 / sr)
    mask = (freqs >= f_lo) & (freqs <= f_hi)
    spec[~mask] = 0.0
    return np.fft.irfft(spec, n=N)


def az_to_compass(az_deg: float, heading: float) -> float:
    """Convert AmbiX azimuth (degrees) to compass bearing.

    compass = heading + azimuth_deg, wrapped to [0, 360).
    """
    return (heading + az_deg) % 360.0


def circular_mean_deg(angles_deg: np.ndarray) -> float:
    """Circular (angular) mean in degrees."""
    rads = np.radians(angles_deg)
    return np.degrees(np.arctan2(np.mean(np.sin(rads)), np.mean(np.cos(rads))))


def circular_std_deg(angles_deg: np.ndarray) -> float:
    """Circular standard deviation in degrees."""
    rads = np.radians(angles_deg)
    R = np.sqrt(np.mean(np.cos(rads))**2 + np.mean(np.sin(rads))**2)
    R = min(R, 1.0)  # clamp for numerical safety
    return np.degrees(np.sqrt(-2.0 * np.log(R)))


def ci_95(values: np.ndarray) -> tuple:
    """Return (lo, hi) of 95 % CI via percentile bootstrap (simple)."""
    lo = np.percentile(values, 2.5)
    hi = np.percentile(values, 97.5)
    return lo, hi


# ---------------------------------------------------------------------------
# Monte Carlo engine
# ---------------------------------------------------------------------------

def run_monte_carlo(df: pd.DataFrame, mc_start: float, mc_end: float,
                    heading: float, rng: np.random.Generator):
    """Run N_TRIALS random-window DOA estimates.

    Returns a dict of arrays keyed by band name (plus 'broadband').
    """
    W = df["W"].values
    Y = df["Y"].values
    Z = df["Z"].values
    X = df["X"].values
    t = df["time_s"].values

    # Index boundaries for MC region
    idx_start = np.searchsorted(t, mc_start, side="left")
    idx_end   = np.searchsorted(t, mc_end, side="right") - 1

    results = {band: {"az": [], "el": [], "energy": []}
               for band in list(FREQ_BANDS.keys()) + ["broadband"]}

    for _ in range(N_TRIALS):
        win_len = rng.integers(WIN_MIN_SAMPLES, WIN_MAX_SAMPLES + 1)
        # Random start so that the full window fits inside the MC region
        max_start = idx_end - win_len
        if max_start <= idx_start:
            max_start = idx_start
        i0 = rng.integers(idx_start, max_start + 1)
        i1 = i0 + win_len

        w = W[i0:i1]
        x = X[i0:i1]
        y = Y[i0:i1]
        z = Z[i0:i1]

        # Broadband
        az = intensity_azimuth(w, x, y)
        el = intensity_elevation(w, x, y, z)
        en = rms_energy(w)
        results["broadband"]["az"].append(az)
        results["broadband"]["el"].append(el)
        results["broadband"]["energy"].append(en)

        # Per-frequency-band
        for band_name, (f_lo, f_hi) in FREQ_BANDS.items():
            w_bp = bandpass_fft(w, f_lo, f_hi, SAMPLE_RATE)
            x_bp = bandpass_fft(x, f_lo, f_hi, SAMPLE_RATE)
            y_bp = bandpass_fft(y, f_lo, f_hi, SAMPLE_RATE)
            z_bp = bandpass_fft(z, f_lo, f_hi, SAMPLE_RATE)

            az_bp = intensity_azimuth(w_bp, x_bp, y_bp)
            el_bp = intensity_elevation(w_bp, x_bp, y_bp, z_bp)
            en_bp = rms_energy(w_bp)

            results[band_name]["az"].append(az_bp)
            results[band_name]["el"].append(el_bp)
            results[band_name]["energy"].append(en_bp)

    # Convert to numpy
    for band in results:
        for k in results[band]:
            results[band][k] = np.array(results[band][k])

    return results


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------

def print_table(label: str, results: dict, heading: float):
    """Pretty-print a results table."""
    sep   = "+" + "-"*22 + "+" + "-"*12 + "+" + "-"*10 + "+" + "-"*18 + "+" + "-"*12 + "+" + "-"*10 + "+" + "-"*18 + "+" + "-"*12 + "+"
    hdr   = "| {:<20s} | {:>10s} | {:>8s} | {:>16s} | {:>10s} | {:>8s} | {:>16s} | {:>10s} |".format(
        "Band", "Az mean(°)", "Az std", "Az 95% CI", "Compass(°)", "Elev(°)", "Elev 95% CI", "RMS energy")

    print()
    print("=" * len(sep))
    print(f"  {label}")
    print(f"  Heading reference: {heading:.1f}°    Trials: {N_TRIALS}")
    print("=" * len(sep))
    print(sep)
    print(hdr)
    print(sep)

    band_order = ["broadband"] + list(FREQ_BANDS.keys())
    for band in band_order:
        r = results[band]
        az_arr = r["az"]
        el_arr = r["el"]
        en_arr = r["energy"]

        az_mean = circular_mean_deg(az_arr)
        az_sd   = circular_std_deg(az_arr)
        az_lo, az_hi = ci_95(az_arr)

        compass = az_to_compass(az_mean, heading)

        el_mean = circular_mean_deg(el_arr)
        el_lo, el_hi = ci_95(el_arr)
        en_mean = np.mean(en_arr)

        print("| {:<20s} | {:>10.2f} | {:>8.2f} | {:>7.2f} .. {:<7.2f} | {:>10.2f} | {:>8.2f} | {:>7.2f} .. {:<7.2f} | {:>10.6f} |".format(
            band, az_mean, az_sd, az_lo, az_hi, compass, el_mean, el_lo, el_hi, en_mean))

    print(sep)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print(f"Monte Carlo DOA Verification – APAC AmbiX recording")
    print(f"CSV : {CSV_PATH}")
    print(f"Rate: {SAMPLE_RATE} Hz   Trials: {N_TRIALS}")
    print(f"Window size: {WIN_MIN_SAMPLES}–{WIN_MAX_SAMPLES} samples "
          f"({WIN_MIN_SAMPLES/SAMPLE_RATE*1000:.1f}–{WIN_MAX_SAMPLES/SAMPLE_RATE*1000:.1f} ms)")

    rng = np.random.default_rng(seed=42)

    for (label, t_centre, mc_start, mc_end, heading), (rd_start, rd_end) in zip(
            EVENTS, READ_WINDOWS):

        print(f"\n{'─'*60}")
        print(f"Loading data for: {label}  (t={rd_start:.1f}–{rd_end:.1f} s) ...")
        t0 = _time.perf_counter()
        df = read_event_window(CSV_PATH, rd_start, rd_end)
        dt_load = _time.perf_counter() - t0
        print(f"  Loaded {len(df):,} rows in {dt_load:.2f} s")

        # Quick single-shot broadband DOA at centre time
        mask = (df["time_s"] >= t_centre - 0.025) & (df["time_s"] <= t_centre + 0.025)
        snap = df.loc[mask]
        if len(snap) > 0:
            az0 = intensity_azimuth(snap["W"].values, snap["X"].values, snap["Y"].values)
            comp0 = az_to_compass(az0, heading)
            print(f"  Single-shot DOA at t={t_centre:.2f}s (50 ms window): "
                  f"az={az0:.2f}°  compass={comp0:.2f}°")

        print(f"  Running {N_TRIALS} Monte Carlo trials in [{mc_start:.2f}, {mc_end:.2f}] s ...")
        t0 = _time.perf_counter()
        results = run_monte_carlo(df, mc_start, mc_end, heading, rng)
        dt_mc = _time.perf_counter() - t0
        print(f"  MC completed in {dt_mc:.2f} s")

        print_table(label, results, heading)

    print("\nDone.")


if __name__ == "__main__":
    main()
