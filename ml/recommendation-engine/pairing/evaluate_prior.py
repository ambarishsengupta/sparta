"""Evaluation of the pairing prior (LLD 7.9, FDD 14.4).

Fit on all baskets before the last eight weeks of the data and test on the last eight weeks. Each real
pair in the test weeks is compared with a pair of the same two slots in which the second article is
replaced by one of the same slot, drawn by Menswear purchase frequency in the test weeks, so popularity
alone does not win. Ties get the mid-rank. Intervals are a bootstrap that resamples customers (all
baskets of one customer together).

An article reaches the score only through its sub-type and colour family, so the replacement is drawn on
(sub-type, colour family) keys with the frequency of the articles that carry them; this is the same
distribution as drawing an article. A replacement can equal the real second item; that pair then ties
with the real one (counted as half), which can only pull the AUC towards 0.5.

Run directly it reads the H&M files named in workflow/local.env, prints the AUC and writes nothing:
    python3 evaluate_prior.py [--env-file PATH]
"""
import argparse
import sys
import time

import numpy as np
import pandas as pd

import prior_lib as pl

SEED = 20201 # fixed seed for the replacement draw
BOOTSTRAP_SEED = 20202
N_BOOT = 1000
SENSITIVITY_SEEDS = (1, 2, 3, 4)
VERDICT_AUC = 0.60


def auc_midrank(pos, neg):
    """P(positive scores above negative) + half of the ties, via mid-ranks of the pooled scores."""
    n1, n0 = len(pos), len(neg)
    if n1 == 0 or n0 == 0:
        return float("nan")
    ranks = pd.Series(np.concatenate([pos, neg])).rank(method="average").to_numpy()
    return float((ranks[:n1].sum() - n1 * (n1 + 1) / 2.0) / (n1 * n0))


def weighted_auc_from_hist(pos_hist, neg_hist):
    """AUC from histograms of positives and negatives over the sorted distinct score values."""
    total_p, total_n = pos_hist.sum(), neg_hist.sum()
    if total_p <= 0 or total_n <= 0:
        return float("nan")
    below = np.cumsum(neg_hist) - neg_hist
    return float((pos_hist * (below + 0.5 * neg_hist)).sum() / (total_p * total_n))


def split_dates(max_day, test_days=pl.TEST_DAYS):
    """Cut-off day: baskets on or before it train, baskets after it (the last `test_days` days) test."""
    return max_day - test_days


def test_frequency(lines, valid, vocab, cutoff):
    """Units bought in the test weeks per (slot, type*n_colours+colour) key: array [slot, key]."""
    test = lines[lines["date"] > cutoff]
    art = test["art"].to_numpy()
    key = valid["type"][art].astype(np.int64) * vocab.n_colours + valid["colour"][art]
    slot = valid["slot"][art].astype(np.int64)
    width = vocab.n_types * vocab.n_colours
    freq = np.bincount(slot * width + key, weights=test["units"].to_numpy(),
                       minlength=len(pl.SLOTS) * width).reshape(len(pl.SLOTS), width)
    return freq


def draw_negatives(test_pairs, freq, vocab, seed=SEED):
    """Replace the second item of every test pair by a same-slot (type, colour) key drawn by test-week frequency."""
    t2n = test_pairs["t2"].to_numpy().copy()
    c2n = test_pairs["c2"].to_numpy().copy()
    sp_arr = test_pairs["sp"].to_numpy()
    rng = np.random.default_rng(seed)
    for sp, (_, second) in enumerate(pl.SLOT_PAIRS):
        rows = np.nonzero(sp_arr == sp)[0]
        if len(rows) == 0:
            continue
        weights = freq[pl.SLOTS.index(second)].astype(float)
        if weights.sum() <= 0:
            raise ValueError(f"no test-week purchases in slot {second}")
        keys = rng.choice(len(weights), size=len(rows), p=weights / weights.sum())
        t2n[rows] = keys // vocab.n_colours
        c2n[rows] = keys % vocab.n_colours
    return t2n, c2n


def bootstrap_intervals(groups, cust, n_boot=N_BOOT, seed=BOOTSTRAP_SEED):
    """Customer bootstrap. groups: {name: (pos_scores, neg_scores, row mask over `cust`)}. Returns {name: (lo, hi)}.

    Every iteration draws customers with replacement and uses the same draw for all groups. A pair
    carries the weight of its customer.
    """
    names = list(groups)
    _, cust_code = np.unique(cust, return_inverse=True)
    n_cust = int(cust_code.max()) + 1 if len(cust_code) else 0
    prepared = {}
    for name in names:
        pos, neg, mask = groups[name]
        values, inverse = np.unique(np.concatenate([pos, neg]), return_inverse=True)
        prepared[name] = (inverse[:len(pos)], inverse[len(pos):], cust_code[mask], len(values))
    rng = np.random.default_rng(seed)
    draws = {name: [] for name in names}
    for _ in range(n_boot):
        w_cust = np.bincount(rng.integers(0, n_cust, n_cust), minlength=n_cust).astype(float)
        for name in names:
            ip, ineg, cc, u = prepared[name]
            w = w_cust[cc]
            draws[name].append(weighted_auc_from_hist(np.bincount(ip, weights=w, minlength=u),
                                                      np.bincount(ineg, weights=w, minlength=u)))
    out = {}
    for name in names:
        arr = np.array(draws[name], dtype=float)
        arr = arr[~np.isnan(arr)]
        out[name] = (float(np.percentile(arr, 2.5)), float(np.percentile(arr, 97.5))) if len(arr) else (float("nan"),) * 2
    return out


def evaluate(train_prior, test_pairs, freq, vocab, n_boot=N_BOOT, seed=SEED):
    """AUC overall and per slot pair with customer-bootstrap 95% intervals, plus counts."""
    test_pairs = test_pairs.sort_values(["sp", "basket", "t1", "c1", "t2", "c2"], kind="stable").reset_index(drop=True)
    sp = test_pairs["sp"].to_numpy().astype(np.int64)
    t1, c1 = test_pairs["t1"].to_numpy(), test_pairs["c1"].to_numpy()
    t2, c2 = test_pairs["t2"].to_numpy(), test_pairs["c2"].to_numpy()
    t2n, c2n = draw_negatives(test_pairs, freq, vocab, seed)
    pos = pl.score_pairs(train_prior, sp, t1, c1, t2, c2)
    neg = pl.score_pairs(train_prior, sp, t1, c1, t2n, c2n)
    cust = test_pairs["cust"].to_numpy()
    result = {"overall": {"auc": auc_midrank(pos, neg), "pairs": int(len(pos))}, "by_slot_pair": {}}
    groups = {"overall": (pos, neg, np.ones(len(pos), dtype=bool))}
    for i, name in enumerate(pl.SLOT_PAIR_NAMES):
        m = sp == i
        result["by_slot_pair"][name] = {"auc": auc_midrank(pos[m], neg[m]), "pairs": int(m.sum())}
        if m.any():
            groups[name] = (pos[m], neg[m], m)
    if len(pos) and n_boot > 0:
        intervals = bootstrap_intervals(groups, cust, n_boot)
        result["overall"]["ci"] = intervals["overall"]
        for name in pl.SLOT_PAIR_NAMES:
            if name in intervals:
                result["by_slot_pair"][name]["ci"] = intervals[name]
    result["test_customers"] = int(len(np.unique(cust)))
    result["test_baskets"] = int(test_pairs["basket"].nunique())
    return result


def seed_sensitivity(train_prior, test_pairs, freq, vocab, seeds=SENSITIVITY_SEEDS):
    """Overall AUC under other fixed seeds of the replacement draw (a check on the draw, not a choice of seed)."""
    return [evaluate(train_prior, test_pairs, freq, vocab, n_boot=0, seed=s)["overall"]["auc"] for s in seeds]


def split_pairs(pairs, cutoff):
    return pairs[pairs["date"] <= cutoff], pairs[pairs["date"] > cutoff]


def main(argv=None):
    import build_prior
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--env-file", default=None)
    ap.add_argument("--bootstrap", type=int, default=N_BOOT)
    args = ap.parse_args(argv)
    t0 = time.time()
    run = build_prior.load_and_fit(args.env_file, n_boot=args.bootstrap)
    ev = run["evaluation"]
    lo, hi = ev["overall"]["ci"]
    print(f"overall AUC {ev['overall']['auc']:.4f} (95% {lo:.4f} to {hi:.4f}) on {ev['overall']['pairs']:,} test pairs")
    for name, r in ev["by_slot_pair"].items():
        print(f"  {name}: AUC {r['auc']:.4f} on {r['pairs']:,} pairs")
    print(f"verdict: {'ships' if ev['overall']['auc'] >= VERDICT_AUC else 'not shippable'}; {time.time() - t0:.0f} s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
