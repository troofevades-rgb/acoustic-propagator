"""
Per-channel energy verification for AmbiX B-format recording.

Reads APAC_raw_samples.csv in chunks to stay within memory limits.
CSV columns: sample, time_s, W, Y, Z, X  (AmbiX ACN/SN3D, 48 kHz)

Outputs:
  - 1-second-window RMS per channel, total energy, SNR, DOA azimuth
  - Top 10 highest-energy moments
  - Energy ratios at key event timestamps
  - Channel-ordering anomaly flags
"""

import sys
import pathlib
import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
CSV_PATH = pathlib.Path(r"C:\Users\mtt_j\Downloads\APAC_raw_samples.csv")
SAMPLE_RATE = 48_000
CHUNK_SIZE = 1_000_000          # rows per chunk (~ 48 MB at 6 float64 cols)
CHANNELS = ["W", "Y", "Z", "X"]

KEY_WINDOWS = {
    "t=0-5s   (ambient/quiet)":  (0, 5),
    "t=9-10s  (PA speech)":      (9, 10),
    "t=25-26s (blast event)":    (25, 26),
    "t=116-117s (peak DOA)":     (116, 117),
}


# ---------------------------------------------------------------------------
# Accumulator -- keeps running sums per 1-second bin so we never hold more
# than one chunk in memory at a time.
# ---------------------------------------------------------------------------
class WindowAccumulator:
    """Accumulates sum-of-squares and cross-products per 1-second window."""

    def __init__(self, duration_s: int = 162):
        n = duration_s
        self.count = np.zeros(n, dtype=np.int64)
        # sum of x^2 for each channel
        self.ss = {ch: np.zeros(n, dtype=np.float64) for ch in CHANNELS}
        # cross-products for DOA: sum(W*Y), sum(W*X)
        self.sum_wy = np.zeros(n, dtype=np.float64)
        self.sum_wx = np.zeros(n, dtype=np.float64)

    def ingest(self, df: pd.DataFrame):
        """Accumulate one chunk into the running totals."""
        time_s = df["time_s"].values
        win_idx = np.floor(time_s).astype(np.int64)
        # Clamp to valid range
        win_idx = np.clip(win_idx, 0, len(self.count) - 1)

        w = df["W"].values
        y = df["Y"].values
        z = df["Z"].values
        x = df["X"].values

        ch_vals = {"W": w, "Y": y, "Z": z, "X": x}

        # Use np.add.at for scatter-add into bins
        for ch in CHANNELS:
            np.add.at(self.ss[ch], win_idx, ch_vals[ch] ** 2)

        np.add.at(self.sum_wy, win_idx, w * y)
        np.add.at(self.sum_wx, win_idx, w * x)
        np.add.at(self.count, win_idx, 1)

    def results(self) -> pd.DataFrame:
        """Compute per-window metrics from accumulated totals."""
        valid = self.count > 0
        n_win = int(np.max(np.where(valid)[0])) + 1 if valid.any() else 0

        rows = []
        for i in range(n_win):
            n = self.count[i]
            if n == 0:
                continue
            rms = {}
            for ch in CHANNELS:
                rms[ch] = np.sqrt(self.ss[ch][i] / n)
            total_energy = sum(self.ss[ch][i] for ch in CHANNELS)
            total_rms = np.sqrt(total_energy / n)

            # SNR: max directional RMS / W RMS
            dir_max = max(rms["Y"], rms["Z"], rms["X"])
            snr = dir_max / rms["W"] if rms["W"] > 0 else np.inf

            # DOA azimuth from intensity vector
            mean_wy = self.sum_wy[i] / n
            mean_wx = self.sum_wx[i] / n
            azimuth_rad = np.arctan2(mean_wy, mean_wx)
            azimuth_deg = np.degrees(azimuth_rad)

            # Highest-energy channel
            max_ch = max(CHANNELS, key=lambda c: rms[c])

            rows.append({
                "window_s": i,
                "n_samples": int(n),
                "RMS_W": rms["W"],
                "RMS_Y": rms["Y"],
                "RMS_Z": rms["Z"],
                "RMS_X": rms["X"],
                "RMS_total": total_rms,
                "SNR_dir_W": snr,
                "DOA_az_deg": azimuth_deg,
                "max_ch": max_ch,
            })

        return pd.DataFrame(rows)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    if not CSV_PATH.exists():
        print(f"ERROR: CSV not found at {CSV_PATH}")
        sys.exit(1)

    print(f"Reading {CSV_PATH}  (chunk size = {CHUNK_SIZE:,} rows)")
    print("=" * 80)

    acc = WindowAccumulator(duration_s=162)
    total_rows = 0

    for chunk_num, chunk in enumerate(
        pd.read_csv(CSV_PATH, chunksize=CHUNK_SIZE, dtype=np.float64)
    ):
        total_rows += len(chunk)
        acc.ingest(chunk)
        elapsed_s = chunk["time_s"].iloc[-1]
        print(f"  chunk {chunk_num:>2d}:  {len(chunk):>10,} rows  "
              f"(cumulative {total_rows:>10,})   t = {elapsed_s:.2f} s")

    print(f"\nTotal rows ingested: {total_rows:,}")
    print("=" * 80)

    df = acc.results()
    if df.empty:
        print("ERROR: no data accumulated.")
        sys.exit(1)

    # ------------------------------------------------------------------
    # 1) Full per-second RMS table
    # ------------------------------------------------------------------
    print("\n\n" + "=" * 80)
    print("1)  PER-SECOND RMS ENERGY TABLE  (all 1-second windows)")
    print("=" * 80)
    pd.set_option("display.max_rows", 200)
    pd.set_option("display.width", 140)
    pd.set_option("display.float_format", lambda x: f"{x:.6f}")
    cols_show = ["window_s", "n_samples", "RMS_W", "RMS_Y", "RMS_Z",
                 "RMS_X", "RMS_total", "SNR_dir_W", "DOA_az_deg", "max_ch"]
    print(df[cols_show].to_string(index=False))

    # ------------------------------------------------------------------
    # 2) Top 10 highest-energy moments
    # ------------------------------------------------------------------
    print("\n\n" + "=" * 80)
    print("2)  TOP 10 HIGHEST-ENERGY WINDOWS  (by RMS_total)")
    print("=" * 80)
    top10 = df.nlargest(10, "RMS_total")
    print(top10[cols_show].to_string(index=False))

    # ------------------------------------------------------------------
    # 3) AmbiX channel ordering verification
    # ------------------------------------------------------------------
    print("\n\n" + "=" * 80)
    print("3)  AMBIX CHANNEL ORDERING VERIFICATION")
    print("    W (omnidirectional) should always have the highest RMS.")
    print("=" * 80)
    anomalies = df[df["max_ch"] != "W"]
    if anomalies.empty:
        print("\n  OK -- W is the highest-energy channel in ALL windows.")
    else:
        print(f"\n  WARNING: {len(anomalies)} window(s) where W is NOT "
              f"the highest-energy channel:\n")
        print(anomalies[cols_show].to_string(index=False))

    # ------------------------------------------------------------------
    # 4) Energy ratios at key timestamps
    # ------------------------------------------------------------------
    print("\n\n" + "=" * 80)
    print("4)  ENERGY RATIOS AT KEY TIMESTAMPS")
    print("=" * 80)

    for label, (t_start, t_end) in KEY_WINDOWS.items():
        sel = df[(df["window_s"] >= t_start) & (df["window_s"] < t_end)]
        if sel.empty:
            print(f"\n  {label}:  NO DATA")
            continue

        print(f"\n  {label}")
        print(f"  {'Channel':<10} {'Mean RMS':>12} {'Ratio to W':>12}")
        print(f"  {'-'*10} {'-'*12} {'-'*12}")
        mean_rms = {ch: sel[f"RMS_{ch}"].mean() for ch in CHANNELS}
        w_rms = mean_rms["W"] if mean_rms["W"] > 0 else 1e-30
        for ch in CHANNELS:
            ratio = mean_rms[ch] / w_rms
            print(f"  {ch:<10} {mean_rms[ch]:>12.8f} {ratio:>12.4f}")
        mean_total = sel["RMS_total"].mean()
        mean_snr = sel["SNR_dir_W"].mean()
        mean_doa = sel["DOA_az_deg"].mean()
        print(f"  {'Total':<10} {mean_total:>12.8f}")
        print(f"  {'SNR':<10} {mean_snr:>12.4f}")
        print(f"  {'DOA (deg)':<10} {mean_doa:>12.2f}")

    # ------------------------------------------------------------------
    # 5) Summary statistics
    # ------------------------------------------------------------------
    print("\n\n" + "=" * 80)
    print("5)  GLOBAL SUMMARY STATISTICS")
    print("=" * 80)

    for ch in CHANNELS:
        col = f"RMS_{ch}"
        print(f"\n  {ch}:  mean={df[col].mean():.8f}  "
              f"median={df[col].median():.8f}  "
              f"max={df[col].max():.8f}  "
              f"min={df[col].min():.8f}")
    print(f"\n  Total RMS:  mean={df['RMS_total'].mean():.8f}  "
          f"max={df['RMS_total'].max():.8f}")
    print(f"  Windows analysed: {len(df)}")
    print(f"  Windows with W dominant: {(df['max_ch'] == 'W').sum()}")
    print(f"  Windows with anomaly:    {(df['max_ch'] != 'W').sum()}")

    # ------------------------------------------------------------------
    # 6) Anomaly detail: full list of non-W-dominant windows
    # ------------------------------------------------------------------
    if not anomalies.empty:
        print("\n\n" + "=" * 80)
        print("6)  FULL ANOMALY LIST  (windows where W is not dominant)")
        print("=" * 80)
        for _, row in anomalies.iterrows():
            t = int(row["window_s"])
            dom = row["max_ch"]
            w_r = row["RMS_W"]
            dom_r = row[f"RMS_{dom}"]
            excess = ((dom_r / w_r) - 1) * 100 if w_r > 0 else float("inf")
            print(f"  t={t:>3d}s  dominant={dom}  "
                  f"RMS_W={w_r:.8f}  RMS_{dom}={dom_r:.8f}  "
                  f"excess={excess:+.2f}%")

    print("\n" + "=" * 80)
    print("Analysis complete.")
    print("=" * 80)


if __name__ == "__main__":
    main()
