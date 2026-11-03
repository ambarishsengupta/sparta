#!/usr/bin/env python3
"""Reproduce the D2 cleaned dataset from the raw H&M files.

Usage:
    python clean_hm.py --raw-dir <folder with the raw csv files> --out-dir <output folder>

Inputs (not in the repository; see README.md):
    articles.csv, customers.csv, transactions_train_sample10pct.csv
Outputs:
    lines_clean.csv.gz, customers_clean.csv.gz, articles_clean.csv.gz, MANIFEST.json

The rules are the cleaning decisions 1 to 9 in the D2 report (section 4) and in ANCP_TM_D3_eda.ipynb.
Output files are sorted and written without timestamps, so the same input gives the same SHA-256.
"""
import argparse, hashlib, json, sys
from pathlib import Path
import numpy as np
import pandas as pd

VERSION = "data-v1.0"
ADULT_DEPTS = ["Ladieswear", "Divided", "Menswear", "Sport"]          # decision 2: Baby/Children is dropped
ROLE = {"Garment Upper body": "Top", "Garment Lower body": "Bottom", "Garment Full body": "Full-body",
        "Accessories": "Accessory", "Bags": "Accessory", "Shoes": "Footwear", "Socks & Tights": "Hosiery",
        "Underwear": "Underwear", "Nightwear": "Nightwear", "Underwear/nightwear": "Nightwear", "Swimwear": "Swimwear"}
AGE_BINS = [0, 17, 24, 34, 44, 54, 64, 200]
AGE_LABELS = ["<18", "18-24", "25-34", "35-44", "45-54", "55-64", "65+"]
KEY_COLS = ["t_dat", "customer_id", "article_id", "price", "sales_channel_id"]
ART_COLS = ["article_id", "product_type_name", "product_group_name", "perceived_colour_master_name",
            "perceived_colour_value_name", "index_group_name", "garment_group_name"]
CUST_COLS = ["customer_id", "FN", "Active", "club_member_status", "fashion_news_frequency", "age"]
# postal_code is not read at all: it is not needed and dropping it is data minimisation (D2 report, section 2)


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def write_csv(df, path):
    # mtime=0 keeps the gzip header constant, so the checksum depends only on the data
    df.to_csv(path, index=False, float_format="%.8g", compression={"method": "gzip", "mtime": 0})


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--raw-dir", required=True, type=Path)
    ap.add_argument("--out-dir", required=True, type=Path)
    ap.add_argument("--transactions", default="transactions_train_sample10pct.csv",
                    help="transactions file to clean (default: the 10%% customer sample)")
    a = ap.parse_args()
    a.out_dir.mkdir(parents=True, exist_ok=True)
    paths = {"articles": a.raw_dir / "articles.csv", "customers": a.raw_dir / "customers.csv",
             "transactions": a.raw_dir / a.transactions}
    for p in paths.values():
        if not p.exists():
            sys.exit(f"missing input file: {p}")

    # ---- load (ids as text so leading zeros are kept)
    art = pd.read_csv(paths["articles"], dtype={"article_id": str}, usecols=ART_COLS)
    cust_all = pd.read_csv(paths["customers"], usecols=CUST_COLS)
    tx = pd.read_csv(paths["transactions"], parse_dates=["t_dat"],
                     dtype={"article_id": str, "sales_channel_id": "int8", "price": "float32"})
    assert list(tx.columns) == KEY_COLS, f"unexpected transaction columns: {list(tx.columns)}"
    n_raw = len(tx)
    assert tx.article_id.isin(art.article_id).all(), "transactions with unknown article"
    art["role"] = art.product_group_name.map(ROLE)
    art["is_menswear"] = art.index_group_name.eq("Menswear")

    # ---- customers: only those who appear in the transactions file (the 10% sample)
    cust = pd.DataFrame({"customer_id": tx.customer_id.drop_duplicates().to_numpy()}).merge(
        cust_all, on="customer_id", how="left")
    cust["age_clean"] = cust.age.where(cust.age <= 90)                                   # decision 5
    cust["age_band"] = pd.cut(cust.age_clean, AGE_BINS, labels=AGE_LABELS).astype(object).fillna("unknown")
    cust["FN"] = cust.FN.fillna(0).astype(int)                                           # decision 6
    cust["Active"] = cust.Active.fillna(0).astype(int)
    cust["club_member_status"] = cust.club_member_status.fillna("UNKNOWN")
    cust["fashion_news_frequency"] = cust.fashion_news_frequency.replace({"None": "NONE"}).fillna("UNKNOWN")
    cust["is_minor"] = cust.age < 18                                                     # decision 4 (missing age is not a minor)
    cust = cust.drop(columns="age")

    # ---- transactions: duplicates become quantity (decision 1), then the scope filters
    funnel = [("raw rows (units)", n_raw)]
    lines = tx.groupby(KEY_COLS, sort=False).size().reset_index(name="qty")
    funnel.append(("lines after collapsing exact duplicates", len(lines)))
    lines = lines.merge(art, on="article_id", how="left")
    funnel.append(("units, all departments", int(lines.qty.sum())))
    lines = lines[lines.index_group_name.isin(ADULT_DEPTS)]
    funnel.append(("units after dropping Baby/Children", int(lines.qty.sum())))
    lines = lines[lines.role.notna()]
    funnel.append(("units after dropping non-apparel groups", int(lines.qty.sum())))
    minors = set(cust.customer_id[cust.is_minor])
    lines = lines[~lines.customer_id.isin(minors)]
    funnel.append(("units after dropping under-18 customers", int(lines.qty.sum())))
    lines = lines.merge(cust[["customer_id", "age_band"]], on="customer_id", how="left")
    lines["week_start"] = (lines.t_dat - pd.to_timedelta(lines.t_dat.dt.dayofweek, unit="D")).dt.strftime("%Y-%m-%d")
    lines["t_dat"] = lines.t_dat.dt.strftime("%Y-%m-%d")
    lines = lines.sort_values(["t_dat", "customer_id", "article_id", "price", "sales_channel_id"],
                              kind="stable").reset_index(drop=True)
    lines = lines[["t_dat", "week_start", "customer_id", "article_id", "price", "sales_channel_id", "qty", "role",
                   "is_menswear", "index_group_name", "product_group_name", "product_type_name",
                   "garment_group_name", "perceived_colour_master_name", "perceived_colour_value_name", "age_band"]]

    # ---- keep only customers and articles that remain in scope, sorted
    cust_out = cust[~cust.is_minor & cust.customer_id.isin(set(lines.customer_id))].drop(columns="is_minor")
    cust_out = cust_out.sort_values("customer_id").reset_index(drop=True)
    art_out = art[art.article_id.isin(set(lines.article_id))].sort_values("article_id").reset_index(drop=True)

    outs = {"lines_clean.csv.gz": lines, "customers_clean.csv.gz": cust_out, "articles_clean.csv.gz": art_out}
    for name, df in outs.items():
        write_csv(df, a.out_dir / name)

    manifest = {
        "dataset_version": VERSION,
        "inputs": {k: {"file": p.name, "sha256": sha256(p), "bytes": p.stat().st_size} for k, p in paths.items()},
        "outputs": {n: {"rows": len(d), "columns": list(d.columns), "sha256": sha256(a.out_dir / n)}
                    for n, d in outs.items()},
        "funnel": [{"step": s, "units": int(n)} for s, n in funnel],
        "menswear_units": int(lines.loc[lines.is_menswear, "qty"].sum()),
        "date_range": [lines.t_dat.min(), lines.t_dat.max()],
        "pandas": pd.__version__, "numpy": np.__version__, "python": sys.version.split()[0],
    }
    (a.out_dir / "MANIFEST.json").write_text(json.dumps(manifest, indent=2))
    for s, n in funnel:
        print(f"{s:45s} {n:>12,}")
    print(f"written to {a.out_dir}; checksums are in MANIFEST.json")


if __name__ == "__main__":
    main()
