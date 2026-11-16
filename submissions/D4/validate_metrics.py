"""Independent re-check. Does not import d4_lib.

1. Rebuilds the weekly segment panel from transactions_clean with separate code (date floor instead of week index)
   and re-derives the B0 and B1 validation WAPE on Menswear segments; compares with experiment_log.csv.
2. Recomputes every model's WAPE from outputs/valid_predictions.csv.gz.
3. Paired bootstrap over Menswear segments (resampling whole segments, 2,000 draws, seed 7) for WAPE differences.
Writes outputs/metric_check.json.
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
data = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE.parent / "D2" / "data-v1.0"
t = pd.read_csv(data / "transactions_clean.csv.gz", dtype={"article_id": str}, usecols=["t_dat", "article_id", "qty"], parse_dates=["t_dat"])
a = pd.read_csv(data / "articles_clean.csv.gz", dtype={"article_id": str},
                usecols=["article_id", "index_group_name", "product_type_name", "perceived_colour_master_name"])
t = t.merge(a, on="article_id")
t = t[t.index_group_name == "Menswear"]
# Week = 7-day bucket ending on a Tuesday, anchored on 2020-09-22.
t["week_end"] = t.t_dat + pd.to_timedelta((1 - t.t_dat.dt.dayofweek) % 7, unit="D")
t = t[t.week_end >= pd.Timestamp("2018-10-02")]
p = t.pivot_table(index=["product_type_name", "perceived_colour_master_name"], columns="week_end", values="qty", aggfunc="sum", fill_value=0)
weeks = pd.date_range("2018-10-02", "2020-09-22", freq="7D")
p = p.reindex(columns=weeks, fill_value=0)
p = p[p.iloc[:, :59].mean(axis=1) >= 2]
Y = p.to_numpy(float)
err0 = err1 = tot = 0.0
for o in range(59, 92, 4):
    for h in (1, 2, 3, 4):
        j = o + h
        y = Y[:, j]
        err0 += np.abs(y - Y[:, j - 52]).sum()
        err1 += np.abs(y - Y[:, o - 3:o + 1].mean(axis=1)).sum()
        tot += y.sum()
out = {"menswear_segments": int(len(Y)), "B0_wape_independent": round(err0 / tot, 5), "B1_wape_independent": round(err1 / tot, 5)}

log = pd.read_csv(HERE / "experiment_log.csv")
for k, prefix in (("B0", "B0"), ("B1", "B1")):
    out[f"{k}_wape_log"] = float(log[log.model.str.startswith(prefix)].wape_menswear.iloc[0])
out["baselines_match"] = all(abs(out[f"{k}_wape_independent"] - out[f"{k}_wape_log"]) < 1e-4 for k in ("B0", "B1"))

v = pd.read_csv(HERE / "outputs" / "valid_predictions.csv.gz")
m = v[v.menswear]
models = ["B0", "B1", "M1", "M2", "M3"]
out["wape_from_predictions"] = {k: round(float(np.abs(m.y - m[k]).sum() / m.y.sum()), 5) for k in models}

segs = m.seg_id.unique()
ae = {k: m.assign(e=np.abs(m.y - m[k])).groupby("seg_id").e.sum().reindex(segs).to_numpy() for k in models}
ys = m.groupby("seg_id").y.sum().reindex(segs).to_numpy()
rng = np.random.default_rng(7)
idx = rng.integers(0, len(segs), size=(2000, len(segs)))
boot = {}
for x_, y_ in [("M3", "B0"), ("M3", "B1"), ("M3", "M1"), ("M3", "M2"), ("M1", "B0")]:
    d = ae[x_][idx].sum(1) / ys[idx].sum(1) - ae[y_][idx].sum(1) / ys[idx].sum(1)
    rel = 1 - (ae[x_][idx].sum(1) / ae[y_][idx].sum(1))
    boot[f"{x_} - {y_}"] = {"diff": round(out["wape_from_predictions"][x_] - out["wape_from_predictions"][y_], 5),
                            "ci95": [round(float(q), 5) for q in np.percentile(d, [2.5, 97.5])],
                            "relative_reduction": round(1 - out["wape_from_predictions"][x_] / out["wape_from_predictions"][y_], 4),
                            "relative_ci95": [round(float(q), 4) for q in np.percentile(rel, [2.5, 97.5])]}
out["bootstrap_over_menswear_segments"] = {"draws": 2000, "seed": 7, **boot}
(HERE / "outputs" / "metric_check.json").write_text(json.dumps(out, indent=2))
print(json.dumps(out, indent=2))
