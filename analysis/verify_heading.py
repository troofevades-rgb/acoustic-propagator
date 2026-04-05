"""
verify_heading.py — Verify device heading against known source positions.

Reads APAC heading & motion CSV, applies drift correction from two
calibration events (blast and PA speaker), and checks corrected headings
against known compass bearings from Mic 7 to Muzzle and PA Speaker S4.

Calibration geometry
--------------------
  Mic 7 (listener): 40.2776602 N, -111.7140867 W
  Muzzle:           40.2775597 N, -111.7139567 W  → bearing 135.4° from Mic 7
  PA Speaker S4:    40.2775638 N, -111.7140627 W  → bearing 169.3° from Mic 7

Calibration events
------------------
  Blast   t = 25.37 s   calibrated_heading = 131.4°   AmbiX az = +3.9°
  PA      t = 120.0 s   calibrated_heading = 241.3°   AmbiX az = -72.0°

Formula: compass_bearing = heading + azimuth
"""

import sys
import pathlib
import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
CSV_PATH = pathlib.Path(r"C:\Users\mtt_j\Downloads\APAC_heading_and_motion.csv")

# Calibration points  (time_s, calibrated_heading_deg)
CAL_BLAST = {"label": "Blast", "t": 25.37, "cal_heading": 131.4,
             "ambix_az": 3.9, "target_compass": 135.4}
CAL_PA    = {"label": "PA",    "t": 120.0, "cal_heading": 241.3,
             "ambix_az": -72.0, "target_compass": 169.3}

DISCONTINUITY_THRESHOLD = 90.0  # degrees

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def angular_diff(a, b):
    """Signed angular difference a - b, wrapped to (-180, 180]."""
    d = (a - b) % 360.0
    return np.where(d > 180.0, d - 360.0, d)


def nearest_row(df, t):
    """Return the row whose time_s is closest to *t*."""
    idx = (df["time_s"] - t).abs().idxmin()
    return df.loc[idx]


def tilt_from_gravity(gx, gy, gz):
    """
    Compute tilt angle (degrees) from accelerometer gravity vector.
    tilt = arccos(gz / |g|) — 0° is upright, 90° is horizontal.
    """
    g_mag = np.sqrt(gx**2 + gy**2 + gz**2)
    # Avoid division by zero
    g_mag = np.where(g_mag == 0, 1e-12, g_mag)
    cos_tilt = np.clip(gz / g_mag, -1.0, 1.0)
    return np.degrees(np.arccos(cos_tilt))


def pitch_roll_from_gravity(gx, gy, gz):
    """
    Pitch = rotation about device X-axis  (screen tilt forward/back)
    Roll  = rotation about device Y-axis  (screen tilt left/right)

    Returns (pitch_deg, roll_deg).
    """
    g_mag = np.sqrt(gx**2 + gy**2 + gz**2)
    g_mag = np.where(g_mag == 0, 1e-12, g_mag)
    pitch = np.degrees(np.arctan2(gy, gz))
    roll  = np.degrees(np.arctan2(-gx, gz))
    return pitch, roll


# ---------------------------------------------------------------------------
# Main analysis
# ---------------------------------------------------------------------------

def main():
    # 1. Read data
    print("=" * 72)
    print("  HEADING TRACK VERIFICATION")
    print("=" * 72)

    df = pd.read_csv(CSV_PATH)
    n = len(df)
    dt_mean = df["time_s"].diff().mean()
    print(f"\nLoaded {n} frames  |  dt_mean = {dt_mean*1000:.2f} ms "
          f" |  time span {df['time_s'].iloc[0]:.2f} – {df['time_s'].iloc[-1]:.2f} s\n")

    # ------------------------------------------------------------------
    # 2. Key heading values (text summary; replaces plot when no mpl)
    # ------------------------------------------------------------------
    print("-" * 72)
    print("  HEADING OVERVIEW")
    print("-" * 72)
    h = df["heading_deg"]
    print(f"  min heading  = {h.min():9.4f}°")
    print(f"  max heading  = {h.max():9.4f}°")
    print(f"  start heading= {h.iloc[0]:9.4f}°   (t = {df['time_s'].iloc[0]:.4f} s)")
    print(f"  end heading  = {h.iloc[-1]:9.4f}°   (t = {df['time_s'].iloc[-1]:.4f} s)")
    print()

    # ------------------------------------------------------------------
    # 3. Drift correction at each calibration point
    # ------------------------------------------------------------------
    print("-" * 72)
    print("  DRIFT CORRECTION AT CALIBRATION POINTS")
    print("-" * 72)

    cal_points = [CAL_BLAST, CAL_PA]
    offsets = []
    for cp in cal_points:
        row = nearest_row(df, cp["t"])
        csv_heading = row["heading_deg"]
        offset = angular_diff(np.array([cp["cal_heading"]]),
                              np.array([csv_heading]))[0]
        cp["csv_heading"] = csv_heading
        cp["offset"] = offset
        cp["actual_t"] = row["time_s"]
        cp["frame"] = int(row["frame"])
        offsets.append(offset)

    fmt = "  {:<8s}  t_req={:>7.2f}s  t_csv={:>9.4f}s  frame={:>5d}  " \
          "csv_hdg={:>9.4f}°  cal_hdg={:>8.1f}°  offset={:>+8.4f}°"
    for cp in cal_points:
        print(fmt.format(cp["label"], cp["t"], cp["actual_t"], cp["frame"],
                         cp["csv_heading"], cp["cal_heading"], cp["offset"]))
    print()

    # ------------------------------------------------------------------
    # 4. Heading discontinuities
    # ------------------------------------------------------------------
    print("-" * 72)
    print("  HEADING DISCONTINUITIES  (jumps > {:.0f}°)".format(
        DISCONTINUITY_THRESHOLD))
    print("-" * 72)

    hdiff = angular_diff(h.values[1:], h.values[:-1])
    big_jumps = np.where(np.abs(hdiff) > DISCONTINUITY_THRESHOLD)[0]

    if len(big_jumps) == 0:
        print("  None found.\n")
    else:
        print(f"  Found {len(big_jumps)} discontinuit{'y' if len(big_jumps)==1 else 'ies'}:\n")
        print(f"  {'frame':>6s}  {'time_s':>10s}  {'hdg_before':>11s}  "
              f"{'hdg_after':>11s}  {'jump':>9s}")
        print(f"  {'-----':>6s}  {'------':>10s}  {'----------':>11s}  "
              f"{'----------':>11s}  {'----':>9s}")
        for idx in big_jumps:
            print(f"  {idx:6d}  {df['time_s'].iloc[idx]:10.4f}  "
                  f"{h.iloc[idx]:11.4f}  {h.iloc[idx+1]:11.4f}  "
                  f"{hdiff[idx]:+9.4f}")
        print()

    # ------------------------------------------------------------------
    # 5. Phone tilt from gravity vector
    # ------------------------------------------------------------------
    print("-" * 72)
    print("  PHONE TILT ANALYSIS  (from gravity vector)")
    print("-" * 72)

    gx = df["gx"].values
    gy = df["gy"].values
    gz = df["gz"].values
    g_mag = np.sqrt(gx**2 + gy**2 + gz**2)
    tilt = tilt_from_gravity(gx, gy, gz)
    pitch, roll = pitch_roll_from_gravity(gx, gy, gz)

    df["tilt_deg"]  = tilt
    df["pitch_deg"] = pitch
    df["roll_deg"]  = roll
    df["g_mag"]     = g_mag

    print(f"  |g| range          : {g_mag.min():.4f} – {g_mag.max():.4f}  "
          f"(expect ~9.81 m/s^2)")
    print(f"  Tilt (from vertical): min {tilt.min():.2f}°  max {tilt.max():.2f}°  "
          f"mean {tilt.mean():.2f}°")
    print(f"  Pitch              : min {pitch.min():.2f}°  max {pitch.max():.2f}°  "
          f"mean {pitch.mean():.2f}°")
    print(f"  Roll               : min {roll.min():.2f}°  max {roll.max():.2f}°  "
          f"mean {roll.mean():.2f}°")

    # Tilt at calibration times
    for cp in cal_points:
        row = nearest_row(df, cp["t"])
        print(f"  Tilt at {cp['label']:<5s} (t={cp['actual_t']:.4f}s): "
              f"tilt={row['tilt_deg']:.2f}°  "
              f"pitch={row['pitch_deg']:.2f}°  "
              f"roll={row['roll_deg']:.2f}°  "
              f"|g|={row['g_mag']:.4f}")
    print()

    # ------------------------------------------------------------------
    # 6. trailer_2 / trailer_4 correlation with pitch / roll
    # ------------------------------------------------------------------
    print("-" * 72)
    print("  TRAILER_2 / TRAILER_4 vs PITCH / ROLL  CORRELATION")
    print("-" * 72)

    t2 = df["trailer_2"].values
    t4 = df["trailer_4"].values

    correlations = {
        ("trailer_2", "pitch_deg"): np.corrcoef(t2, pitch)[0, 1],
        ("trailer_2", "roll_deg"):  np.corrcoef(t2, roll)[0, 1],
        ("trailer_2", "tilt_deg"): np.corrcoef(t2, tilt)[0, 1],
        ("trailer_4", "pitch_deg"): np.corrcoef(t4, pitch)[0, 1],
        ("trailer_4", "roll_deg"):  np.corrcoef(t4, roll)[0, 1],
        ("trailer_4", "tilt_deg"): np.corrcoef(t4, tilt)[0, 1],
    }

    print(f"  {'pair':<30s}  {'Pearson r':>10s}")
    print(f"  {'----':<30s}  {'---------':>10s}")
    for (a, b), r in correlations.items():
        tag = ""
        if abs(r) > 0.9:
            tag = "  ** STRONG **"
        elif abs(r) > 0.7:
            tag = "  * moderate *"
        print(f"  {a + ' vs ' + b:<30s}  {r:>+10.6f}{tag}")
    print()

    # Also check trailer_2 / trailer_4 against heading_rad (= trailer_1)
    hrad = df["heading_rad"].values
    r_t2_hrad = np.corrcoef(t2, hrad)[0, 1]
    r_t4_hrad = np.corrcoef(t4, hrad)[0, 1]
    print(f"  trailer_2 vs heading_rad     : r = {r_t2_hrad:+.6f}")
    print(f"  trailer_4 vs heading_rad     : r = {r_t4_hrad:+.6f}")
    print()

    # ------------------------------------------------------------------
    # 7. Drift rate between calibration points
    # ------------------------------------------------------------------
    print("-" * 72)
    print("  DRIFT RATE")
    print("-" * 72)

    dt_cal = CAL_PA["actual_t"] - CAL_BLAST["actual_t"]
    d_offset = CAL_PA["offset"] - CAL_BLAST["offset"]
    drift_rate = d_offset / dt_cal if dt_cal != 0 else float("nan")

    print(f"  Offset at Blast : {CAL_BLAST['offset']:+.4f}°  (t = {CAL_BLAST['actual_t']:.4f} s)")
    print(f"  Offset at PA    : {CAL_PA['offset']:+.4f}°  (t = {CAL_PA['actual_t']:.4f} s)")
    print(f"  Delta offset    : {d_offset:+.4f}°  over {dt_cal:.4f} s")
    print(f"  Drift rate      : {drift_rate:+.6f} °/s  ({drift_rate*3600:+.4f} °/hr)")
    print()

    # ------------------------------------------------------------------
    # 8 & 9. Verify drift-corrected heading at blast and PA times
    # ------------------------------------------------------------------
    print("-" * 72)
    print("  DRIFT-CORRECTED HEADING VERIFICATION")
    print("-" * 72)

    # Linear drift model: offset(t) = offset_blast + drift_rate * (t - t_blast)
    t_blast = CAL_BLAST["actual_t"]
    offset_blast = CAL_BLAST["offset"]

    def corrected_heading(t, csv_hdg):
        """Apply linear drift correction to a raw CSV heading."""
        offset_at_t = offset_blast + drift_rate * (t - t_blast)
        return (csv_hdg + offset_at_t) % 360.0

    # -- Blast verification --
    blast_row = nearest_row(df, CAL_BLAST["t"])
    blast_csv_hdg = blast_row["heading_deg"]
    blast_corrected = corrected_heading(blast_row["time_s"], blast_csv_hdg)
    blast_compass = (blast_corrected + CAL_BLAST["ambix_az"]) % 360.0
    blast_err = angular_diff(np.array([blast_compass]),
                             np.array([CAL_BLAST["target_compass"]]))[0]

    # -- PA verification --
    pa_row = nearest_row(df, CAL_PA["t"])
    pa_csv_hdg = pa_row["heading_deg"]
    pa_corrected = corrected_heading(pa_row["time_s"], pa_csv_hdg)
    pa_compass = (pa_corrected + CAL_PA["ambix_az"]) % 360.0
    pa_err = angular_diff(np.array([pa_compass]),
                          np.array([CAL_PA["target_compass"]]))[0]

    print()
    print(f"  Linear drift model:  offset(t) = {offset_blast:+.4f} "
          f"+ ({drift_rate:+.6f}) * (t - {t_blast:.4f})")
    print()

    header = (f"  {'Event':<8s}  {'t (s)':>9s}  {'CSV hdg':>9s}  "
              f"{'Offset':>9s}  {'Corr hdg':>9s}  {'Az':>7s}  "
              f"{'Compass':>9s}  {'Target':>9s}  {'Error':>9s}")
    sep = "  " + "-" * (len(header) - 2)
    print(header)
    print(sep)

    # Blast row
    blast_offset_at_t = offset_blast + drift_rate * (blast_row["time_s"] - t_blast)
    print(f"  {'Blast':<8s}  {blast_row['time_s']:9.4f}  {blast_csv_hdg:9.4f}  "
          f"{blast_offset_at_t:+9.4f}  {blast_corrected:9.4f}  "
          f"{CAL_BLAST['ambix_az']:+7.1f}  {blast_compass:9.4f}  "
          f"{CAL_BLAST['target_compass']:9.1f}  {blast_err:+9.4f}")

    # PA row
    pa_offset_at_t = offset_blast + drift_rate * (pa_row["time_s"] - t_blast)
    print(f"  {'PA':<8s}  {pa_row['time_s']:9.4f}  {pa_csv_hdg:9.4f}  "
          f"{pa_offset_at_t:+9.4f}  {pa_corrected:9.4f}  "
          f"{CAL_PA['ambix_az']:+7.1f}  {pa_compass:9.4f}  "
          f"{CAL_PA['target_compass']:9.1f}  {pa_err:+9.4f}")
    print()

    # ------------------------------------------------------------------
    # Summary verdict
    # ------------------------------------------------------------------
    print("=" * 72)
    print("  SUMMARY VERDICT")
    print("=" * 72)
    blast_ok = abs(blast_err) < 1.0
    pa_ok    = abs(pa_err) < 1.0
    print(f"  Blast compass error : {blast_err:+.4f}°  "
          f"{'PASS' if blast_ok else 'FAIL'}  (threshold ±1.0°)")
    print(f"  PA compass error    : {pa_err:+.4f}°  "
          f"{'PASS' if pa_ok else 'FAIL'}  (threshold ±1.0°)")
    print(f"  Drift rate          : {drift_rate:+.6f} °/s  "
          f"({drift_rate*3600:+.2f} °/hr)")
    print(f"  Discontinuities     : {len(big_jumps)}")
    print(f"  Mean tilt           : {tilt.mean():.2f}°")
    print()

    # Best trailer correlation
    best_key = max(correlations, key=lambda k: abs(correlations[k]))
    best_r = correlations[best_key]
    print(f"  Strongest trailer correlation: {best_key[0]} vs {best_key[1]}  "
          f"r = {best_r:+.6f}")
    print()

    if blast_ok and pa_ok:
        print("  >>> ALL CHECKS PASSED <<<")
    else:
        print("  >>> SOME CHECKS FAILED — review offsets <<<")
    print("=" * 72)

    # ------------------------------------------------------------------
    # Optional: try to plot if matplotlib is available
    # ------------------------------------------------------------------
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt

        fig, axes = plt.subplots(4, 1, figsize=(14, 16), sharex=True)

        # (a) Heading vs time
        ax = axes[0]
        ax.plot(df["time_s"], df["heading_deg"], linewidth=0.5, color="steelblue")
        for cp in cal_points:
            ax.axvline(cp["actual_t"], color="red", linewidth=0.8, linestyle="--",
                       label=f'{cp["label"]} t={cp["actual_t"]:.2f}s')
        ax.set_ylabel("Heading (°)")
        ax.set_title("Raw heading_deg vs time")
        ax.legend(fontsize=8)
        ax.grid(True, alpha=0.3)

        # (b) Drift-corrected heading
        ax = axes[1]
        corr_hdg = corrected_heading(df["time_s"].values, df["heading_deg"].values)
        ax.plot(df["time_s"], corr_hdg, linewidth=0.5, color="forestgreen")
        for cp in cal_points:
            ax.axvline(cp["actual_t"], color="red", linewidth=0.8, linestyle="--")
        ax.set_ylabel("Corrected heading (°)")
        ax.set_title("Drift-corrected heading")
        ax.grid(True, alpha=0.3)

        # (c) Tilt
        ax = axes[2]
        ax.plot(df["time_s"], df["tilt_deg"], linewidth=0.5, color="darkorange",
                label="tilt")
        ax.plot(df["time_s"], df["pitch_deg"], linewidth=0.3, alpha=0.6,
                label="pitch")
        ax.plot(df["time_s"], df["roll_deg"], linewidth=0.3, alpha=0.6,
                label="roll")
        ax.set_ylabel("Angle (°)")
        ax.set_title("Phone tilt / pitch / roll from gravity")
        ax.legend(fontsize=8)
        ax.grid(True, alpha=0.3)

        # (d) trailer_2 and trailer_4
        ax = axes[3]
        ax.plot(df["time_s"], df["trailer_2"], linewidth=0.5, label="trailer_2")
        ax.plot(df["time_s"], df["trailer_4"], linewidth=0.5, label="trailer_4")
        ax.set_xlabel("Time (s)")
        ax.set_ylabel("Trailer value")
        ax.set_title("trailer_2 and trailer_4 vs time")
        ax.legend(fontsize=8)
        ax.grid(True, alpha=0.3)

        plt.tight_layout()
        out_path = pathlib.Path(__file__).parent / "heading_verification.png"
        fig.savefig(out_path, dpi=150)
        plt.close(fig)
        print(f"\n  Plot saved to {out_path}")
    except ImportError:
        print("\n  (matplotlib not available — skipping plot)")


if __name__ == "__main__":
    main()
