"""D4 shared code: weekly segment panel, features at a forecast origin, baselines, metrics.

A feature for origin o (a week index) uses weeks <= o only.
"""
from __future__ import annotations

import hashlib
from pathlib import Path

import numpy as np
import pandas as pd

END = pd.Timestamp("2020-09-22")
N_WEEKS = 104
H = (1, 2, 3, 4)
VALID_ORIGINS = list(range(59, 92, 4))      # 59, 63, ..., 91 -> targets 60..95
TEST_ORIGINS = [95, 99]                     # targets 96..103, NOT run in D4 (charter R4)
CALIB_ORIGINS = [o for o in VALID_ORIGINS if o <= 75]
CHECK_ORIGINS = [o for o in VALID_ORIGINS if o > 75]
MIN_MEAN = 2.0
ELIG_WEEKS = range(0, 59)
NUM = ["lag1", "lag2", "lag3", "lag4", "m4", "m8", "m13", "m26", "ly", "ly3", "lyl4", "yoy"]
CATS = ["dept", "ptype", "colour"]
LGB_FEATS = NUM + ["h", "woy_sin", "woy_cos"] + CATS


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def week_end(i: int) -> pd.Timestamp:
    return END - pd.Timedelta(days=7 * (N_WEEKS - 1 - i))


def load_panel(data_dir):
    d = Path(data_dir)
    sums = {ln.split()[1]: ln.split()[0] for ln in (d / "SHA256SUMS.txt").read_text().splitlines() if ln.strip()}
    got = sha256(d / "transactions_clean.csv.gz")
    if got != sums["transactions_clean.csv.gz"]:
        raise SystemExit(f"transactions_clean.csv.gz checksum mismatch: {got}")
    t = pd.read_csv(d / "transactions_clean.csv.gz", dtype={"article_id": str},
                    usecols=["t_dat", "article_id", "qty"], parse_dates=["t_dat"])
    a = pd.read_csv(d / "articles_clean.csv.gz", dtype={"article_id": str},
                    usecols=["article_id", "index_group_name", "product_type_name", "perceived_colour_master_name"])
    t = t.merge(a, on="article_id")
    t["w"] = N_WEEKS - 1 - (END - t.t_dat).dt.days // 7
    dropped = int(t.loc[t.w < 0, "qty"].sum())
    t = t[t.w >= 0]
    keys = ["index_group_name", "product_type_name", "perceived_colour_master_name"]
    g = t.groupby(keys + ["w"]).qty.sum().unstack(fill_value=0).reindex(columns=range(N_WEEKS), fill_value=0)
    keep = g.loc[:, list(ELIG_WEEKS)].mean(axis=1) >= MIN_MEAN
    g = g[keep]
    seg = g.index.to_frame(index=False)
    seg.columns = ["dept", "ptype", "colour"]
    for c in CATS:
        seg[c] = seg[c].astype("category")
    seg["menswear"] = seg.dept.astype(str).eq("Menswear")
    info = dict(version=f"data-v1.0 (tx sha256 {got[:12]})", units_total=int(t.qty.sum()), units_partial_week_dropped=dropped,
                segments_all=int(len(keep)), segments_kept=int(keep.sum()), segments_menswear=int(seg.menswear.sum()),
                share_units_kept=float(g.to_numpy().sum() / t.qty.sum()))
    return g.to_numpy(dtype=float), seg, info


def _mean(Y, lo, hi):
    """Mean over weeks lo..hi inclusive, clipped to the panel; NaN if the window is empty."""
    lo2, hi2 = max(lo, 0), min(hi, Y.shape[1] - 1)
    if hi2 < lo2:
        return np.full(Y.shape[0], np.nan)
    return Y[:, lo2:hi2 + 1].mean(axis=1)


def features(Y, seg, origins, with_target=True):
    rows = []
    for o in origins:
        base = {f"lag{k}": Y[:, o - k + 1] for k in (1, 2, 3, 4)}
        base.update(m4=_mean(Y, o - 3, o), m8=_mean(Y, o - 7, o), m13=_mean(Y, o - 12, o), m26=_mean(Y, o - 25, o))
        base["lyl4"] = _mean(Y, o - 55, o - 52) if o - 55 >= 0 else np.full(len(Y), np.nan)
        for k in (8, 13):  # window clipped at week 0 when the year-ago history is shorter than k
            base[f"lyl{k}"] = _mean(Y, o - 51 - k, o - 52) if o - 52 >= 0 else np.full(len(Y), np.nan)
        for h in H:
            j = o + h
            r = pd.DataFrame(base)
            r["ly"] = Y[:, j - 52] if j - 52 >= 0 else np.nan
            r["ly3"] = _mean(Y, j - 53, j - 51) if j - 53 >= 0 else np.nan
            r["yoy"] = (r.m4 + 1) / (r.lyl4 + 1)
            r["h"], r["origin"], r["target_week"], r["seg_id"] = h, o, j, np.arange(len(Y))
            r["woy_sin"], r["woy_cos"] = np.sin(2 * np.pi * (j % 52) / 52), np.cos(2 * np.pi * (j % 52) / 52)
            if with_target:
                r["y"] = Y[:, j] if j < Y.shape[1] else np.nan
            rows.append(r)
    x = pd.concat(rows, ignore_index=True)
    x = x.join(seg[CATS + ["menswear"]], on="seg_id")
    return x


def wape(y, f):
    y, f = np.asarray(y, float), np.asarray(f, float)
    return float(np.abs(y - f).sum() / y.sum())


def bias(y, f):
    y, f = np.asarray(y, float), np.asarray(f, float)
    return float((f - y).sum() / y.sum())


# ---------- rule forecasts ----------
def b0_snaive(x):
    return x.ly.to_numpy()


def b1_naive(x):
    return x.m4.to_numpy()


def m1_scaled_snaive(x, k, shrink, smooth):
    base = x.ly if smooth == 1 else x.ly3
    recent = {4: x.m4, 8: x.m8, 13: x.m13}[k]
    last = {4: x.lyl4, 8: x.lyl8, 13: x.lyl13}[k]
    r = ((recent + 1) / (last + 1)).clip(0.2, 5.0)
    return (base * (1 + shrink * (r - 1))).clip(lower=0).to_numpy()
