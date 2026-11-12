"""D4 experiments on the validation origins only. Every run appends one row to experiment_log.csv.

  python -I run_experiments.py [--data ../D2/data-v1.0]

The test origins (95, 99) are declared in validation_design.json and are not run here (charter risk R4: untouched until D5).
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import sys
import time
from itertools import product
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.linear_model import PoissonRegressor
from sklearn.preprocessing import StandardScaler

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))  # python -I drops the script folder from sys.path
import d4_lib as L  # noqa: E402

OUT = HERE / "outputs"
LOG = HERE / "experiment_log.csv"
COLS = ["run_id", "timestamp_utc", "stage", "origins", "model", "data_version", "features", "params", "seed",
        "wape_menswear", "wape_all", "bias_menswear", "n_forecasts_menswear", "runtime_s", "design_sha", "code_sha", "notes"]
DESIGN_SHA = L.sha256(HERE / "validation_design.json")[:12]
CODE_SHA = L.sha256(HERE / "d4_lib.py")[:6] + L.sha256(Path(__file__))[:6]
ORIG = f"{L.VALID_ORIGINS[0]}..{L.VALID_ORIGINS[-1]} step 4"


def log_run(model, version, feats, params, seed, x, f, secs, stage="valid", notes="", extra=None):
    men = x.menswear.to_numpy()
    wm, wa, bm = L.wape(x.y[men], f[men]), L.wape(x.y, f), L.bias(x.y[men], f[men])
    new = not LOG.exists()
    n_prev = 0 if new else sum(1 for _ in open(LOG)) - 1
    with open(LOG, "a", newline="") as fh:
        w = csv.writer(fh)
        if new:
            w.writerow(COLS)
        w.writerow([f"R{n_prev + 1:03d}", dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), stage, ORIG, model,
                    version, feats, json.dumps(params, sort_keys=True), seed, round(wm, 5), round(wa, 5), round(bm, 5),
                    int(men.sum()), round(secs, 1), DESIGN_SHA, CODE_SHA, notes if extra is None else f"{notes} {extra}".strip()])
    print(f"{model:34s} WAPE men={wm:.4f} all={wa:.4f} bias={bm:+.3f} {params}", flush=True)
    return wm


# ---------- learned models: refit at every validation origin on earlier origins ----------
def train_rows(Y, seg, o):
    return L.features(Y, seg, range(13, o - 3))          # training origins o' <= o-4, all targets <= o


GLM_LOG = [c for c in L.NUM if c != "yoy"]


def glm_matrix(x, fill=None):
    d = x[L.NUM].copy()
    d["ly_missing"] = d.ly.isna().astype(float)
    if fill is None:
        fill = {}
    for c in ["ly", "ly3", "lyl4", "yoy"]:
        d[c] = d[c].fillna(d.m4 if c != "yoy" else 1.0)
    d[GLM_LOG] = np.log1p(d[GLM_LOG])
    d["yoy"] = np.log(d.yoy)
    d["woy_sin"], d["woy_cos"] = x.woy_sin, x.woy_cos
    d = pd.concat([d, pd.get_dummies(x.h.astype(str), prefix="h", dtype=float),
                   pd.get_dummies(x.dept, prefix="d", dtype=float), pd.get_dummies(x.colour, prefix="c", dtype=float)], axis=1)
    return d


def fit_predict_glm(Y, seg, alpha):
    preds = []
    for o in L.VALID_ORIGINS:
        tr, va = train_rows(Y, seg, o), L.features(Y, seg, [o])
        Xtr, Xva = glm_matrix(tr), glm_matrix(va)
        Xva = Xva.reindex(columns=Xtr.columns, fill_value=0.0)
        sc = StandardScaler().fit(Xtr)
        m = PoissonRegressor(alpha=alpha, max_iter=500).fit(sc.transform(Xtr), tr.y)
        preds.append(m.predict(sc.transform(Xva)))
    return np.concatenate(preds)


def fit_predict_lgb(Y, seg, p, seed):
    preds = []
    for o in L.VALID_ORIGINS:
        tr, va = train_rows(Y, seg, o), L.features(Y, seg, [o])
        m = lgb.LGBMRegressor(objective="tweedie", n_jobs=-1, verbose=-1, random_state=seed,
                              bagging_freq=1 if p["subsample"] < 1 else 0, **p)
        m.fit(tr[L.LGB_FEATS], tr.y, categorical_feature=L.CATS)
        preds.append(m.predict(va[L.LGB_FEATS]))
    return np.concatenate(preds), m


def sample_lgb(rng):
    return dict(num_leaves=int(rng.choice([7, 15, 31, 63])),
                learning_rate=float(np.round(np.exp(rng.uniform(np.log(0.02), np.log(0.2))), 4)),
                n_estimators=int(rng.choice([200, 400, 800])),
                min_child_samples=int(rng.choice([20, 50, 100])),
                colsample_bytree=float(rng.choice([0.6, 0.8, 1.0])),
                subsample=float(rng.choice([0.7, 1.0])),
                tweedie_variance_power=float(rng.choice([1.1, 1.3, 1.5])))


def main(data):
    Y, seg, info = L.load_panel(data)
    v = info["version"]
    print(info, flush=True)
    OUT.mkdir(exist_ok=True)
    (OUT / "panel_info.json").write_text(json.dumps(info, indent=2))
    x = L.features(Y, seg, L.VALID_ORIGINS)
    preds = {}

    t0 = time.time(); f = L.b0_snaive(x)
    log_run("B0 seasonal naive (same week last year)", v, "ly", {"lag_weeks": 52}, "n/a", x, f, time.time() - t0); preds["B0"] = f
    t0 = time.time(); f = L.b1_naive(x)
    log_run("B1 naive (mean of last 4 weeks)", v, "m4", {"window_weeks": 4}, "n/a", x, f, time.time() - t0); preds["B1"] = f

    res = []
    for k, s, sm in product((4, 8, 13), (0.0, 0.5, 1.0), (1, 3)):
        t0 = time.time(); f = L.m1_scaled_snaive(x, k, s, sm)
        p = dict(window_weeks=k, shrink=s, ly_smooth=sm)
        res.append((log_run("M1 scaled seasonal naive", v, "ly|ly3, m_k, lyl_k", p, "n/a", x, f, time.time() - t0), -s, p, f))
    best = {"M1": min(res, key=lambda z: (z[0], z[1]))[2]}
    preds["M1"] = min(res, key=lambda z: (z[0], z[1]))[3]

    res = []
    for a in (0.001, 0.01, 0.1, 1.0):
        t0 = time.time(); f = fit_predict_glm(Y, seg, a)
        res.append((log_run("M2 Poisson GLM", v, ",".join(L.NUM) + ",h,woy,dept,colour", {"alpha": a}, "n/a", x, f, time.time() - t0,
                            notes="refit at each of 9 origins"), -a, {"alpha": a}, f))
    w, _, best["M2"], preds["M2"] = min(res, key=lambda z: (z[0], z[1]))

    rng = np.random.default_rng(42)
    trials = []
    for i in range(12):
        p = sample_lgb(rng)
        t0 = time.time(); f, _ = fit_predict_lgb(Y, seg, p, 42)
        trials.append((log_run("M3 LightGBM Tweedie (global)", v, ",".join(L.LGB_FEATS), p, 42, x, f, time.time() - t0,
                               notes=f"random-search trial {i + 1}/12; refit at each of 9 origins"), p, f))
    wbest, bp, preds["M3"] = min(trials, key=lambda z: z[0])
    best["M3"] = bp
    for seed in (1, 2, 3):
        t0 = time.time(); f, mod = fit_predict_lgb(Y, seg, bp, seed)
        log_run("M3 LightGBM Tweedie (global)", v, ",".join(L.LGB_FEATS), bp, seed, x, f, time.time() - t0,
                notes="seed rerun of best trial")
    imp = pd.Series(mod.booster_.feature_importance("gain"), index=L.LGB_FEATS)
    (imp / imp.sum()).sort_values(ascending=False).round(4).to_csv(OUT / "m3_feature_importance_gain.csv", header=["share_of_gain"])

    # ---------- selection on menswear WAPE ----------
    men = x.menswear.to_numpy()
    score = {k: L.wape(x.y[men], f[men]) for k, f in preds.items()}
    chosen = min(["M1", "M2", "M3"], key=lambda k: score[k])

    # ---------- 80% interval: split conformal by horizon (calibrate early origins, check late origins) ----------
    f = preds[chosen]
    r = np.log((x.y + 1) / (f + 1))
    cal = x.origin.isin(L.CALIB_ORIGINS).to_numpy()
    q = {h: np.quantile(r[cal & (x.h == h).to_numpy()], [0.10, 0.90]) for h in L.H}
    lo = np.array([(f[i] + 1) * np.exp(q[h][0]) - 1 for i, h in enumerate(x.h)])
    hi = np.array([(f[i] + 1) * np.exp(q[h][1]) - 1 for i, h in enumerate(x.h)])
    chk = ~cal
    inside = (x.y.to_numpy() >= lo) & (x.y.to_numpy() <= hi)
    cov = {"model": chosen, "calibration_origins": L.CALIB_ORIGINS, "check_origins": L.CHECK_ORIGINS,
           "coverage_menswear": round(float(inside[chk & men].mean()), 4), "coverage_all": round(float(inside[chk].mean()), 4),
           "quantiles_log_ratio": {str(h): [round(float(a), 4) for a in q[h]] for h in L.H}}
    (OUT / "interval_check.json").write_text(json.dumps(cov, indent=2))
    with open(LOG, "a", newline="") as fh:
        n_prev = sum(1 for _ in open(LOG)) - 1
        csv.writer(fh).writerow([f"R{n_prev + 1:03d}", dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "valid-interval",
                                 "calibrate 59..75, check 79..91", f"{chosen} 80% interval (split conformal)", v, "log residual by horizon",
                                 json.dumps({"level": 0.8}), "n/a", "", "", "", int((chk & men).sum()), "", DESIGN_SHA, CODE_SHA,
                                 f"coverage_menswear={cov['coverage_menswear']} coverage_all={cov['coverage_all']}"])
    print("interval", cov, flush=True)

    keep = x[["seg_id", "origin", "h", "target_week", "y", "menswear", "dept", "ptype", "colour"]].copy()
    for k, f_ in preds.items():
        keep[k] = np.round(f_, 4)
    keep["M3_lo80"], keep["M3_hi80"] = np.round(lo, 4), np.round(hi, 4)
    keep.to_csv(OUT / "valid_predictions.csv.gz", index=False)

    # ---------- tables for the report ----------
    rows = []
    for o in L.VALID_ORIGINS:
        m = (x.origin == o).to_numpy() & men
        rows.append({"origin": o, "first_target_week_end": str(L.week_end(o + 1).date()),
                     **{k: round(L.wape(x.y[m], f_[m]), 4) for k, f_ in preds.items()}})
    pd.DataFrame(rows).to_csv(OUT / "wape_by_origin_menswear.csv", index=False)
    rows = []
    for h in L.H:
        m = (x.h == h).to_numpy() & men
        rows.append({"h": h, **{k: round(L.wape(x.y[m], f_[m]), 4) for k, f_ in preds.items()}})
    pd.DataFrame(rows).to_csv(OUT / "wape_by_horizon_menswear.csv", index=False)
    (OUT / "selected_configs.json").write_text(json.dumps(
        {"selected_on": "validation origins 59..91 (targets 2019-11-20 to 2020-07-21), menswear WAPE", "design_sha": DESIGN_SHA,
         "chosen_for_D5": chosen, "valid_wape_menswear": {k: round(s, 5) for k, s in score.items()}, **best}, indent=2))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=str(HERE.parent / "D2" / "data-v1.0"))
    main(ap.parse_args().data)
