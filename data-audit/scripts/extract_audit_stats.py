#!/usr/bin/env python3
"""
Extract audit statistics from the H&M Personalized Fashion Recommendations files.

Purpose
    Sparta ANCP D2 (data audit) and D3 (EDA). Run this once on a machine that has the three
    raw files. It writes small summary files that can be shared; it does not need the raw data
    to leave the machine.

Inputs (CSV files, default folder data-audit/raw/)
    articles.csv, customers.csv, transactions_train.csv

Outputs (default folder data-audit/audit_stats/)
    Summary tables as CSV, run_info.json, and audit_stats.zip containing all of them.
    No customer IDs are written unless --write-menswear-extract is used.

Needs: Python 3.8 or later, pandas and numpy. Nothing else.

Usage
    python extract_audit_stats.py                      # full run
    python extract_audit_stats.py --max-rows 500000    # quick test on the first 500,000 transactions
    python extract_audit_stats.py --raw-dir D:/hm --out-dir D:/hm_stats
    python extract_audit_stats.py --write-menswear-extract   # also write a menswear-only transactions file

Memory and time: transactions are read in chunks, so about 4 GB of free memory is enough.
A full run on the 31.8 million row file typically takes 10 to 30 minutes.
Use --skip-duplicates to save memory (about 1 GB less) if the machine is short of memory.

Licence note: the H&M data is covered by the Kaggle competition rules (non-commercial research and
education). The summary files are derived from it; read the rules before publishing them.
"""
import argparse
import hashlib
import json
import os
import platform
import sys
import time
import zipfile
from datetime import date

import numpy as np
import pandas as pd

SCRIPT_VERSION = "1.0"

TX_COLS = ["t_dat", "customer_id", "article_id", "price", "sales_channel_id"]
ARTICLE_VALUE_COLS = [
    "index_group_name", "index_name", "index_code", "product_group_name", "product_type_name",
    "garment_group_name", "section_name", "department_name", "colour_group_name",
    "perceived_colour_master_name", "perceived_colour_value_name", "graphical_appearance_name",
]
# Product attributes only: no free text (prod_name, detail_desc) is written to the outputs.
ARTICLE_KEEP_COLS = [
    "article_id", "product_code", "product_type_no", "product_type_name", "product_group_name",
    "graphical_appearance_no", "graphical_appearance_name", "colour_group_code", "colour_group_name",
    "perceived_colour_value_id", "perceived_colour_value_name", "perceived_colour_master_id",
    "perceived_colour_master_name", "department_no", "department_name", "index_code", "index_name",
    "index_group_no", "index_group_name", "section_no", "section_name", "garment_group_no",
    "garment_group_name",
]
AGE_BINS = [0, 18, 25, 35, 45, 55, 65, 200]
AGE_LABELS = ["<18", "18-24", "25-34", "35-44", "45-54", "55-64", "65+"]


def log(msg):
    print(time.strftime("%H:%M:%S"), msg, flush=True)


def sha256_of(path, block=1 << 20):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            b = f.read(block)
            if not b:
                break
            h.update(b)
    return h.hexdigest()


def hash_ids(series):
    """Stable 64-bit hash of an ID column, so IDs can be counted without keeping the strings."""
    return pd.util.hash_pandas_object(series, index=False).values


def missing_table(df):
    n = len(df)
    out = pd.DataFrame({"column": df.columns, "missing": [int(df[c].isna().sum()) for c in df.columns]})
    out["pct_missing"] = (out["missing"] / max(n, 1) * 100).round(3)
    return out


def write_csv(df, out_dir, name, index=False):
    path = os.path.join(out_dir, name)
    df.to_csv(path, index=index)
    return name


def age_band(age_series):
    b = pd.cut(age_series, bins=AGE_BINS, labels=AGE_LABELS, right=False)
    b = b.astype(object)
    return pd.Series(np.where(pd.isna(b), "missing", b), index=age_series.index)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--raw-dir", default=os.path.join("data-audit", "raw"))
    ap.add_argument("--out-dir", default=os.path.join("data-audit", "audit_stats"))
    ap.add_argument("--chunk-size", type=int, default=2_000_000)
    ap.add_argument("--max-rows", type=int, default=None, help="only read the first N transactions (test runs)")
    ap.add_argument("--menswear-groups", default="Menswear",
                    help="comma-separated index_group_name values counted as menswear (default: Menswear)")
    ap.add_argument("--skip-checksums", action="store_true")
    ap.add_argument("--skip-duplicates", action="store_true", help="skip the exact duplicate-row count (saves memory)")
    ap.add_argument("--price-sample-step", type=int, default=16, help="use every Nth price for quantiles")
    ap.add_argument("--write-menswear-extract", action="store_true",
                    help="also write menswear_transactions.csv.gz (row level, hashed customer IDs)")
    args = ap.parse_args()

    menswear_groups = [g.strip() for g in args.menswear_groups.split(",") if g.strip()]
    os.makedirs(args.out_dir, exist_ok=True)
    t0 = time.time()
    written = []
    info = {
        "script_version": SCRIPT_VERSION,
        "run_date": date.today().isoformat(),
        "python": sys.version.split()[0],
        "pandas": pd.__version__,
        "numpy": np.__version__,
        "platform": platform.platform(),
        "args": vars(args),
        "menswear_groups": menswear_groups,
    }

    paths = {n: os.path.join(args.raw_dir, n + ".csv") for n in ["articles", "customers", "transactions_train"]}
    for n, p in paths.items():
        if not os.path.exists(p):
            sys.exit("Missing file: %s (use --raw-dir to point at the folder)" % p)

    # ------------------------------------------------------------------ file inventory
    log("File inventory")
    inv = []
    for n, p in paths.items():
        row = {"file": os.path.basename(p), "size_bytes": os.path.getsize(p),
               "sha256": "skipped" if args.skip_checksums else sha256_of(p)}
        with open(p, "r", encoding="utf-8", errors="replace") as f:
            row["header"] = f.readline().strip()
        inv.append(row)
    written.append(write_csv(pd.DataFrame(inv), args.out_dir, "00_file_inventory.csv"))

    # ------------------------------------------------------------------ articles
    log("Reading articles.csv")
    art = pd.read_csv(paths["articles"], dtype=str)
    info["articles_rows"] = int(len(art))
    info["articles_columns"] = list(art.columns)
    written.append(write_csv(missing_table(art), args.out_dir, "10_articles_missing.csv"))
    info["articles_duplicate_article_id"] = int(art["article_id"].duplicated().sum())
    info["articles_duplicate_full_rows"] = int(art.duplicated().sum())
    written.append(write_csv(art["article_id"].str.len().value_counts().rename_axis("article_id_length")
                             .reset_index(name="count"), args.out_dir, "11_articles_id_length.csv"))
    vc_rows = []
    for c in [c for c in ARTICLE_VALUE_COLS if c in art.columns]:
        vc = art[c].value_counts(dropna=False).head(100)
        for v, k in vc.items():
            vc_rows.append({"column": c, "value": "(missing)" if pd.isna(v) else v, "count": int(k)})
    written.append(write_csv(pd.DataFrame(vc_rows), args.out_dir, "12_articles_value_counts.csv"))
    if {"index_group_name", "product_group_name"}.issubset(art.columns):
        ct = pd.crosstab(art["index_group_name"].fillna("(missing)"), art["product_group_name"].fillna("(missing)"))
        written.append(write_csv(ct, args.out_dir, "13_articles_index_group_by_product_group.csv", index=True))
    if "index_group_name" not in art.columns:
        sys.exit("articles.csv has no index_group_name column")
    is_men_art = art["index_group_name"].isin(menswear_groups)
    info["articles_menswear_count"] = int(is_men_art.sum())
    if is_men_art.sum() == 0:
        log("WARNING: no articles match --menswear-groups %s; check 12_articles_value_counts.csv" % menswear_groups)
    keep = [c for c in ARTICLE_KEEP_COLS if c in art.columns]
    written.append(write_csv(art.loc[is_men_art, keep], args.out_dir, "14_articles_menswear.csv"))

    # ------------------------------------------------------------------ customers
    log("Reading customers.csv")
    cus = pd.read_csv(paths["customers"], dtype=str)
    info["customers_rows"] = int(len(cus))
    info["customers_columns"] = list(cus.columns)
    written.append(write_csv(missing_table(cus), args.out_dir, "20_customers_missing.csv"))
    info["customers_duplicate_customer_id"] = int(cus["customer_id"].duplicated().sum())
    info["customer_id_lengths"] = {str(k): int(v) for k, v in cus["customer_id"].str.len().value_counts().items()}
    cus["age_num"] = pd.to_numeric(cus["age"], errors="coerce") if "age" in cus.columns else np.nan
    if "age" in cus.columns:
        info["customers_age_not_numeric"] = int((cus["age"].notna() & cus["age_num"].isna()).sum())
        desc = cus["age_num"].describe(percentiles=[.01, .05, .25, .5, .75, .95, .99])
        info["customers_age_describe"] = {k: (None if pd.isna(v) else float(v)) for k, v in desc.items()}
        info["customers_age_under_16"] = int((cus["age_num"] < 16).sum())
        info["customers_age_over_90"] = int((cus["age_num"] > 90).sum())
        hist = age_band(cus["age_num"]).value_counts().reindex(AGE_LABELS + ["missing"], fill_value=0)
        written.append(write_csv(hist.rename_axis("age_band").reset_index(name="customers"),
                                 args.out_dir, "21_customers_age_bands.csv"))
    vc_rows = []
    for c in ["FN", "Active", "club_member_status", "fashion_news_frequency"]:
        if c in cus.columns:
            for v, k in cus[c].value_counts(dropna=False).items():
                vc_rows.append({"column": c, "value": "(missing)" if pd.isna(v) else v, "count": int(k)})
    written.append(write_csv(pd.DataFrame(vc_rows), args.out_dir, "22_customers_value_counts.csv"))
    if "postal_code" in cus.columns:
        pc = cus["postal_code"].value_counts(dropna=False)
        info["postal_code_unique"] = int(cus["postal_code"].nunique())
        top = pc.head(10)
        written.append(write_csv(pd.DataFrame({
            "postal_code_hash_first8": ["(missing)" if pd.isna(i) else str(i)[:8] for i in top.index],
            "customers": top.values,
            "share_pct": (top.values / len(cus) * 100).round(3)}), args.out_dir, "23_customers_top_postal_hashes.csv"))

    # lookup tables for the transaction pass
    art_cols_for_join = {c: art.set_index("article_id")[c] for c in
                         ["index_group_name", "product_group_name", "product_type_name",
                          "perceived_colour_master_name", "graphical_appearance_name"] if c in art.columns}
    age_lookup = cus.set_index("customer_id")["age_num"]
    art_hashes = np.unique(hash_ids(art["article_id"]))
    cus_hashes = np.unique(hash_ids(cus["customer_id"]))
    menswear_art_ids = set(art.loc[is_men_art, "article_id"])

    # ------------------------------------------------------------------ transactions
    log("Reading transactions_train.csv in chunks (this is the long step)")
    reader = pd.read_csv(paths["transactions_train"], chunksize=args.chunk_size, nrows=args.max_rows,
                         dtype={"customer_id": str, "article_id": str, "t_dat": str})
    n_rows = 0
    miss = {c: 0 for c in TX_COLS}
    bad_dates = 0
    dmin = dmax = None
    price_n = 0
    price_sum = 0.0
    price_min = np.inf
    price_max = -np.inf
    price_zero = price_neg = 0
    price_sample = []
    month_counts = {}
    month_group_counts = {}
    channel_counts = {}
    row_hashes = []
    cust_unique = np.array([], dtype=np.uint64)
    art_unique = np.array([], dtype=np.uint64)
    men_cust_unique = np.array([], dtype=np.uint64)
    cust_counts = None
    orphan_art = orphan_cus = 0
    unmapped_art = 0
    age_all = {}
    age_men = {}
    weekly_parts = []
    men_rows = 0
    extract_path = os.path.join(args.out_dir, "menswear_transactions.csv.gz")
    if args.write_menswear_extract and os.path.exists(extract_path):
        os.remove(extract_path)

    for i, ch in enumerate(reader, 1):
        n_rows += len(ch)
        for c in TX_COLS:
            if c in ch.columns:
                miss[c] += int(ch[c].isna().sum())
        dt = pd.to_datetime(ch["t_dat"], format="%Y-%m-%d", errors="coerce")
        bad_dates += int(dt.isna().sum())
        if dt.notna().any():
            lo, hi = dt.min(), dt.max()
            dmin = lo if dmin is None or lo < dmin else dmin
            dmax = hi if dmax is None or hi > dmax else dmax
        price = pd.to_numeric(ch["price"], errors="coerce")
        price_n += int(price.notna().sum())
        price_sum += float(price.sum())
        if price.notna().any():
            price_min = min(price_min, float(price.min()))
            price_max = max(price_max, float(price.max()))
        price_zero += int((price == 0).sum())
        price_neg += int((price < 0).sum())
        price_sample.append(price.iloc[::args.price_sample_step].dropna().values)

        month = dt.dt.strftime("%Y-%m")
        for k, v in month.value_counts().items():
            month_counts[k] = month_counts.get(k, 0) + int(v)
        if "sales_channel_id" in ch.columns:
            for k, v in ch["sales_channel_id"].value_counts(dropna=False).items():
                channel_counts[str(k)] = channel_counts.get(str(k), 0) + int(v)

        if not args.skip_duplicates:
            row_hashes.append(pd.util.hash_pandas_object(ch[TX_COLS], index=False).values)

        ch_cust = hash_ids(ch["customer_id"])
        ch_art = hash_ids(ch["article_id"])
        cust_unique = np.unique(np.concatenate([cust_unique, np.unique(ch_cust)]))
        art_unique = np.unique(np.concatenate([art_unique, np.unique(ch_art)]))
        vc = pd.Series(ch_cust).value_counts()
        cust_counts = vc if cust_counts is None else cust_counts.add(vc, fill_value=0)
        orphan_art += int((~np.isin(ch_art, art_hashes)).sum())
        orphan_cus += int((~np.isin(ch_cust, cus_hashes)).sum())

        mapped = {c: ch["article_id"].map(s) for c, s in art_cols_for_join.items()}
        ig = mapped.get("index_group_name", pd.Series("(unknown)", index=ch.index)).fillna("(unknown)")
        unmapped_art += int((ig == "(unknown)").sum())
        mg = pd.DataFrame({"month": month, "index_group_name": ig}).groupby(["month", "index_group_name"]).size()
        for (m, g), v in mg.items():
            month_group_counts[(m, g)] = month_group_counts.get((m, g), 0) + int(v)

        band = age_band(ch["customer_id"].map(age_lookup))
        for k, v in band.value_counts().items():
            age_all[k] = age_all.get(k, 0) + int(v)

        is_men = ch["article_id"].isin(menswear_art_ids)
        if is_men.any():
            m = ch[is_men]
            men_rows += len(m)
            men_cust_unique = np.unique(np.concatenate([men_cust_unique, np.unique(ch_cust[is_men.values])]))
            for k, v in band[is_men].value_counts().items():
                age_men[k] = age_men.get(k, 0) + int(v)
            wk = (dt[is_men] - pd.to_timedelta(dt[is_men].dt.weekday, unit="D")).dt.strftime("%Y-%m-%d")
            g = pd.DataFrame({
                "week_start": wk,
                "product_group_name": mapped.get("product_group_name", pd.Series(np.nan, index=ch.index))[is_men],
                "product_type_name": mapped.get("product_type_name", pd.Series(np.nan, index=ch.index))[is_men],
                "perceived_colour_master_name": mapped.get("perceived_colour_master_name", pd.Series(np.nan, index=ch.index))[is_men],
                "graphical_appearance_name": mapped.get("graphical_appearance_name", pd.Series(np.nan, index=ch.index))[is_men],
                "sales_channel_id": m["sales_channel_id"].astype(str).values if "sales_channel_id" in m.columns else "",
                "price": price[is_men].values,
            }).fillna("(missing)")
            keys = [c for c in g.columns if c != "price"]
            part = g.groupby(keys).agg(transactions=("price", "size"), price_sum=("price", "sum")).reset_index()
            weekly_parts.append(part)
            if args.write_menswear_extract:
                m.to_csv(extract_path, mode="a", header=not os.path.exists(extract_path),
                         index=False, compression="gzip")
        log("  chunk %d done: %s rows so far" % (i, format(n_rows, ",")))

    # ------------------------------------------------------------------ transaction summaries
    log("Writing transaction summaries")
    info["transactions_rows"] = n_rows
    info["transactions_missing"] = miss
    info["transactions_bad_dates"] = bad_dates
    info["date_min"] = None if dmin is None else dmin.strftime("%Y-%m-%d")
    info["date_max"] = None if dmax is None else dmax.strftime("%Y-%m-%d")
    info["unique_customers_in_transactions"] = int(len(cust_unique))
    info["unique_articles_in_transactions"] = int(len(art_unique))
    info["customers_without_transactions"] = int(len(np.setdiff1d(cus_hashes, cust_unique)))
    info["articles_never_sold"] = int(len(np.setdiff1d(art_hashes, art_unique)))
    info["transaction_rows_with_unknown_article"] = orphan_art
    info["transaction_rows_with_unknown_customer"] = orphan_cus
    info["transaction_rows_unmapped_index_group"] = unmapped_art
    if not args.skip_duplicates and row_hashes:
        allh = np.concatenate(row_hashes)
        info["transactions_exact_duplicate_rows"] = int(len(allh) - len(np.unique(allh)))
        del allh
    ps = np.concatenate(price_sample) if price_sample else np.array([])
    info["price"] = {
        "count": price_n, "mean": (price_sum / price_n) if price_n else None,
        "min": None if price_min == np.inf else price_min, "max": None if price_max == -np.inf else price_max,
        "zero_rows": price_zero, "negative_rows": price_neg,
        "quantiles_from_sample": {str(q): float(np.quantile(ps, q)) for q in
                                  [0.001, 0.01, 0.05, 0.25, 0.5, 0.75, 0.95, 0.99, 0.999]} if len(ps) else {},
        "sample_size": int(len(ps)),
    }
    info["menswear_transaction_rows"] = men_rows
    info["menswear_unique_customers"] = int(len(men_cust_unique))

    written.append(write_csv(pd.DataFrame(sorted(month_counts.items()), columns=["month", "transactions"]),
                             args.out_dir, "30_transactions_by_month.csv"))
    written.append(write_csv(pd.DataFrame(
        [(m, g, v) for (m, g), v in sorted(month_group_counts.items())],
        columns=["month", "index_group_name", "transactions"]), args.out_dir, "31_transactions_by_month_and_index_group.csv"))
    written.append(write_csv(pd.DataFrame(sorted(channel_counts.items()), columns=["sales_channel_id", "transactions"]),
                             args.out_dir, "32_transactions_by_sales_channel.csv"))
    # purchases per customer (distribution): number of customers with k transactions, k grouped
    cc = cust_counts.astype(int)
    tiers = pd.cut(cc, bins=[0, 1, 2, 5, 10, 20, 50, 100, 10**9],
                   labels=["1", "2", "3-5", "6-10", "11-20", "21-50", "51-100", "100+"])
    written.append(write_csv(tiers.value_counts().reindex(tiers.cat.categories, fill_value=0)
                             .rename_axis("transactions_per_customer").reset_index(name="customers"),
                             args.out_dir, "33_transactions_per_customer.csv"))
    info["transactions_per_customer_describe"] = {k: float(v) for k, v in cc.describe().items()}
    ages = pd.DataFrame({"age_band": AGE_LABELS + ["missing"]})
    ages["all_transactions"] = ages["age_band"].map(age_all).fillna(0).astype(int)
    ages["menswear_transactions"] = ages["age_band"].map(age_men).fillna(0).astype(int)
    written.append(write_csv(ages, args.out_dir, "34_age_band_all_vs_menswear.csv"))
    if weekly_parts:
        weekly = pd.concat(weekly_parts, ignore_index=True)
        keys = [c for c in weekly.columns if c not in ("transactions", "price_sum")]
        weekly = weekly.groupby(keys, as_index=False).sum().sort_values(keys)
        written.append(write_csv(weekly, args.out_dir, "40_menswear_weekly.csv"))
    if args.write_menswear_extract and os.path.exists(extract_path):
        written.append("menswear_transactions.csv.gz")

    info["elapsed_seconds"] = round(time.time() - t0, 1)
    with open(os.path.join(args.out_dir, "run_info.json"), "w") as f:
        json.dump(info, f, indent=2, default=str)
    written.append("run_info.json")

    zip_path = os.path.join(args.out_dir, "audit_stats.zip")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for name in written:
            if name != "menswear_transactions.csv.gz":
                z.write(os.path.join(args.out_dir, name), name)
    log("Done in %.1f minutes" % ((time.time() - t0) / 60))
    log("Zip to share: %s (%.1f MB)" % (zip_path, os.path.getsize(zip_path) / 1e6))
    if args.write_menswear_extract:
        log("Menswear extract (not in the zip): %s (%.1f MB)" % (extract_path, os.path.getsize(extract_path) / 1e6))


if __name__ == "__main__":
    main()
