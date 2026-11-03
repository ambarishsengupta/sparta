#!/usr/bin/env python3
"""Build the pairing prior and the H&M unlock list, evaluate the prior and write the prior card (LLD 7.9).

    python3 ml/recommendation-engine/pairing/build_prior.py [--env-file PATH]

Reads the three H&M files from SPARTA_DATA_ROOT_HM (read-only) and writes
    $SPARTA_ARTIFACT_DIR/pairing-prior-v1.json
    $SPARTA_ARTIFACT_DIR/unlock-candidates.json
    ml/recommendation-engine/pairing/PRIOR_CARD.md            (committed; no row, article id or customer id)
The settings come from workflow/local.env (found by walking up from this script); the environment
variables SPARTA_DATA_ROOT_HM and SPARTA_ARTIFACT_DIR override it. No H&M row is written anywhere.

The prior written is fitted on ALL baskets; the AUC on the card comes from the same procedure fitted on
the baskets before the last eight weeks and tested on those eight weeks (evaluate_prior.py).
Allowed libraries: pandas, numpy and the standard library.
"""
import argparse
import datetime
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

import evaluate_prior as ev
import prior_lib as pl
import sparta_env

CARD_PATH = Path(__file__).resolve().parent / "PRIOR_CARD.md"
PRIOR_NAME = "pairing-prior-v1.json"
UNLOCK_NAME = "unlock-candidates.json"
HM_FILES = ("articles.csv", "customers.csv", "transactions_train.csv")


def log(message):
    print(f"[{time.strftime('%H:%M:%S')}] {message}", flush=True)


def colour_reading_counts(art):
    """Menswear article counts for the readings of the Maroon and Navy rules (documents disagree)."""
    men = art[art["index_group_name"] == pl.MENSWEAR]
    red = men["perceived_colour_master_name"] == "Red"
    blue = men["perceived_colour_master_name"] == "Blue"
    return {
        "red_dark_red_group": int((red & (men["colour_group_name"] == "Dark Red")).sum()),
        "red_value_dark": int((red & (men["perceived_colour_value_name"] == "Dark")).sum()),
        "red_both": int((red & (men["colour_group_name"] == "Dark Red") & (men["perceived_colour_value_name"] == "Dark")).sum()),
        "blue_value_dark": int((blue & (men["perceived_colour_value_name"] == "Dark")).sum()),
        "blue_dark_blue_group": int((blue & (men["colour_group_name"] == "Dark Blue")).sum()),
    }


def load_and_fit(env_file=None, n_boot=ev.N_BOOT, chunksize=2_000_000, log_fn=log):
    """Read the H&M files, form the pairs, fit and evaluate. Returns everything the outputs need."""
    t0 = time.time()
    settings = sparta_env.load_settings(env_file)
    root = settings[sparta_env.HM_KEY]
    paths = {name: root / name for name in HM_FILES}
    for path in paths.values():
        if not path.is_file():
            raise SystemExit(f"missing H&M file: {path}")
    hashes = {}
    for name, path in paths.items():
        log_fn(f"SHA-256 of {name}")
        hashes[name] = pl.sha256_file(path)

    type_map, colour_map = pl.load_type_map(), pl.load_colour_map()
    sub_types, colour_families, _, _ = pl.load_taxonomy()
    vocab = pl.Vocab(type_map, colour_families)

    log_fn("articles and customers")
    art = pd.read_csv(paths["articles.csv"], dtype={"article_id": str}, usecols=[
        "article_id", "product_type_name", "garment_group_name", "index_group_name", "colour_group_name",
        "perceived_colour_master_name", "perceived_colour_value_name"])
    customers = pd.read_csv(paths["customers.csv"], usecols=["customer_id", "age"])
    code_map, valid, art_stats = pl.prepare_articles(art, type_map, colour_map, vocab)
    cust_index, minor = pl.minor_customers(customers)
    art_stats["colour_readings"] = colour_reading_counts(art)
    art_stats["minor_customers"] = int(minor.sum())
    art_stats["customers"] = int(len(customers))
    del art, customers

    log_fn("transactions in chunks")
    lines, read_stats = pl.read_lines(pl.iter_csv_chunks(paths["transactions_train.csv"], chunksize), code_map, cust_index, minor)
    log_fn(f"{read_stats['rows']:,} rows read, {len(lines):,} usable lines")
    read_stats["lines"] = int(len(lines))
    read_stats["units"] = int(lines["units"].sum())

    pairs, pair_stats = pl.build_pairs(lines, valid)
    max_day = pl.date_to_days(read_stats["max_date"])
    cutoff = ev.split_dates(max_day)
    train_pairs, test_pairs = ev.split_pairs(pairs, cutoff)
    log_fn(f"{pair_stats['pairs']:,} pairs; train {len(train_pairs):,}, test {len(test_pairs):,}")

    log_fn("fit on the training baskets and evaluate on the last eight weeks")
    train_prior = pl.fit_prior(train_pairs, vocab.n_types, vocab.n_colours)
    freq = ev.test_frequency(lines, valid, vocab, cutoff)
    evaluation = ev.evaluate(train_prior, test_pairs, freq, vocab, n_boot=n_boot)
    evaluation["seed_aucs"] = ev.seed_sensitivity(train_prior, test_pairs, freq, vocab)

    log_fn("fit on all baskets")
    full_prior = pl.fit_prior(pairs, vocab.n_types, vocab.n_colours)
    candidates = pl.unlock_candidates(lines, valid, vocab)

    split = {
        "cutoff": str(np.datetime64(int(cutoff), "D")), "first_test_day": str(np.datetime64(int(cutoff) + 1, "D")),
        "last_day": read_stats["max_date"], "first_day": read_stats["min_date"],
        "train_pairs": int(len(train_pairs)), "test_pairs": int(len(test_pairs)),
        "train_baskets": int(train_pairs["basket"].nunique()), "test_baskets": int(test_pairs["basket"].nunique()),
        "train_by_slot_pair": {n: int((train_pairs["sp"] == i).sum()) for i, n in enumerate(pl.SLOT_PAIR_NAMES)},
        "test_by_slot_pair": {n: int((test_pairs["sp"] == i).sum()) for i, n in enumerate(pl.SLOT_PAIR_NAMES)},
    }
    return {"settings": settings, "hashes": hashes, "vocab": vocab, "art_stats": art_stats, "read_stats": read_stats,
            "pair_stats": pair_stats, "split": split, "train_prior": train_prior, "full_prior": full_prior,
            "evaluation": evaluation, "candidates": candidates, "seconds": time.time() - t0}


def type_pair_rows(prior, vocab):
    """All type pairs above the basket floor: (ln lift, slot pair, first, second, baskets, pairs)."""
    rows = []
    for sp, name in enumerate(pl.SLOT_PAIR_NAMES):
        for i, a in enumerate(vocab.types):
            for j, b in enumerate(vocab.types):
                if prior["baskets_type"][sp, i, j] >= prior["min_baskets"]:
                    rows.append((float(prior["ln_type"][sp, i, j]), name, a, b,
                                 int(prior["baskets_type"][sp, i, j]), int(prior["pairs_type"][sp, i, j])))
    return rows


def pearson(a, b):
    a, b = np.asarray(a, float), np.asarray(b, float)
    if len(a) < 2 or a.std() == 0 or b.std() == 0:
        return float("nan")
    return float(np.corrcoef(a, b)[0, 1])


def fmt(n):
    return f"{n:,}"


def render_card(run, prior_sha, unlock_sha, prior_stats, build_date):
    ev_ = run["evaluation"]
    vocab = run["vocab"]
    auc = ev_["overall"]["auc"]
    lo, hi = ev_["overall"]["ci"]
    verdict = "ships" if auc >= ev.VERDICT_AUC else "not shippable"
    rs, ps, sp_, ar = run["read_stats"], run["pair_stats"], run["split"], run["art_stats"]
    L = []
    add = L.append
    add("# Pairing prior card: pairing-prior-v1")
    add("")
    add(f"**Verdict: `{verdict}`.** Overall AUC {auc:.4f} (95% interval {lo:.4f} to {hi:.4f}); the bar is 0.60 (LLD 7.9, FDD 14.4).")
    if verdict == "not shippable":
        add("")
        add("The prior is below the bar. It does not ship and `NEXT_PUBLIC_PAIRING_PRIOR_ENABLED` stays false. Nothing was tuned to move this number.")
    add("")
    add("A pass would mean only that the prior predicts what H&M customers bought together better than chance. It does not show that the outfits are stylish; the style review (FDD 14.4) remains.")
    add("")
    add("| Field | Value |")
    add("| --- | --- |")
    add(f"| Built | {build_date} by `build_prior.py` (pandas {pd.__version__}, numpy {np.__version__}); run time {run['seconds'] / 60:.1f} minutes |")
    add(f"| Source files | the three H&M files named below, read in full, nothing written back; the prior holds no row, article, customer, basket or date |")
    add(f"| Prior written | `pairing-prior-v1.json`, fitted on all baskets; SHA-256 `{prior_sha}` |")
    add(f"| Unlock list written | `unlock-candidates.json`, {len(run['candidates'])} entries; SHA-256 `{unlock_sha}` |")
    add(f"| Both files | in the git-ignored artifact folder (`SPARTA_ARTIFACT_DIR`), never committed; `models.manifest.json` keeps them marked not built |")
    add("")
    add("## Source files (SHA-256)")
    add("")
    add("| File | SHA-256 |")
    add("| --- | --- |")
    for name in HM_FILES:
        add(f"| `{name}` | `{run['hashes'][name]}` |")
    add("")
    add("## How it was built")
    add("")
    add("- Lines: `transactions_train.csv` read in chunks (three columns, ids as text), kept when the article is in the Menswear index group, fills a top, bottom, layer or footwear slot through `garment_v2/type_map.json`, has a Sparta colour family through `garment_v2/colour_map.json`, and the customer is not under 18 (missing age is kept). Duplicate lines collapse into a quantity; a pair is counted once per basket whatever the quantity.")
    add("- Slots for pairs: Layer is Jacket, Blazer, Coat or Cardigan; Top is T-shirt, Polo, Shirt, Sweater or Hoodie; Bottom is Trousers, Jeans or Shorts; Footwear is Sneakers or Boots. Four slot pairs are scored, the four the outfit score uses: Top+Bottom, Top+Footwear, Bottom+Footwear and Layer+Top.")
    add("- Basket: one customer's lines on one date, kept with at least two usable Menswear articles. Pair: two distinct articles of a basket in different slots of one slot pair.")
    add("- Score: `lift = (n_ab + 5) / (E_ab + 5)` with `E_ab = n_a n_b / N` inside the slot pair; colour pairs the same way on colour families inside the slot pair; a type pair or colour pair seen in fewer than 30 baskets is neutral (ln lift 0); ln lift is clipped to -2..2. The file stores `sigmoid(clipped ln lift)` per table (0.5 neutral); a pair of items scores `sigmoid(logit(type value) + logit(colour value))`. Neutral entries are not listed.")
    add(f"- Evaluation: fit on all baskets on or before {sp_['cutoff']}, test on baskets from {sp_['first_test_day']} to {sp_['last_day']} (the last eight weeks of the data, {ps_days(sp_)} days). Every real test pair is compared with a pair of the same two slots in which the second item is replaced by a (sub-type, colour family) drawn by test-week Menswear purchase frequency in that slot (fixed seed). Ties get the mid-rank. The interval is a bootstrap of {ev.N_BOOT} resamples of customers (all baskets of one customer together), percentile 2.5 to 97.5.")
    add("- Not tuned: smoothing 5, floor 30, clip 2 and the 0.60 bar are the values of LLD 7.9; nothing was changed after seeing a result.")
    add("")
    add("## Overall result and per slot pair")
    add("")
    add("| Slot pair | AUC | 95% interval (customer bootstrap) | Test pairs |")
    add("| --- | --- | --- | --- |")
    add(f"| **Overall** | **{auc:.4f}** | {lo:.4f} to {hi:.4f} | {fmt(ev_['overall']['pairs'])} |")
    for name in pl.SLOT_PAIR_NAMES:
        r = ev_["by_slot_pair"][name]
        if "ci" in r:
            add(f"| {name} | {r['auc']:.4f} | {r['ci'][0]:.4f} to {r['ci'][1]:.4f} | {fmt(r['pairs'])} |")
        else:
            add(f"| {name} | n/a | n/a | {fmt(r['pairs'])} |")
    add("")
    add(f"Test customers {fmt(ev_['test_customers'])}; test baskets with a pair {fmt(ev_['test_baskets'])}.")
    add("")
    seeds = ev_.get("seed_aucs") or []
    if seeds:
        add(f"Draw check: the replacement draw uses a fixed seed (the AUC above). With {len(seeds)} other fixed seeds (1 to {len(seeds)}) the overall AUC is {min(seeds):.4f} to {max(seeds):.4f}. This is a check on the draw, not a choice of seed; the seed above was fixed before the first run.")
    add("")
    add("## Counts")
    add("")
    add("| What | Count |")
    add("| --- | --- |")
    add(f"| Transaction lines read | {fmt(rs['rows'])} ({rs['min_date']} to {rs['max_date']}) |")
    add(f"| Lines of Menswear articles | {fmt(rs['menswear_rows'])} |")
    add(f"| Lines usable (slot, sub-type and colour family) | {fmt(rs['usable_rows'])} |")
    add(f"| Usable lines of customers under 18, dropped | {fmt(rs['minor_rows'])} |")
    add(f"| Usable lines with a customer not in customers.csv, dropped | {fmt(rs['unknown_customer_rows'])} |")
    add(f"| Lines after collapsing duplicates (customer, date, article) | {fmt(rs['lines'])} ({fmt(rs['units'])} units) |")
    add(f"| Baskets with a usable article | {fmt(ps['baskets_with_usable_article'])} |")
    add(f"| Baskets kept (two or more usable articles) | {fmt(ps['baskets_kept'])} |")
    add(f"| Baskets with at least one pair | {fmt(ps['baskets_with_pair'])} |")
    add(f"| Pairs, all | {fmt(ps['pairs'])} |")
    add(f"| Pairs, training part / test part | {fmt(sp_['train_pairs'])} / {fmt(sp_['test_pairs'])} |")
    add(f"| Baskets with a pair, training part / test part | {fmt(sp_['train_baskets'])} / {fmt(sp_['test_baskets'])} |")
    add(f"| Menswear articles / usable articles | {fmt(ar['menswear_articles'])} / {fmt(ar['usable_articles'])} |")
    add(f"| Menswear articles with no top, bottom, layer or footwear slot (accessories, underwear, swimwear and others, and Other shoe) | {fmt(ar['no_slot_accessory_or_other'])} |")
    add(f"| Menswear articles with no colour family (Metal, Mole, Unknown, undefined) | {fmt(ar['slot_but_no_colour_family'])} |")
    add(f"| Customers / customers under 18 | {fmt(ar['customers'])} / {fmt(ar['minor_customers'])} |")
    add("")
    add("| Slot pair | Pairs, all | Training | Test |")
    add("| --- | --- | --- | --- |")
    for name in pl.SLOT_PAIR_NAMES:
        add(f"| {name} | {fmt(ps['pairs_by_slot_pair'][name])} | {fmt(sp_['train_by_slot_pair'][name])} | {fmt(sp_['test_by_slot_pair'][name])} |")
    add("")
    add("## Tables written")
    add("")
    add(f"Non-neutral entries in `pairing-prior-v1.json` (a pair seen in at least 30 baskets): {prior_stats['type_entries']} type pairs and {prior_stats['colour_entries']} colour pairs. A missing entry is neutral (0.5).")
    add("")
    add(f"Stability: across the {prior_stats['common']} type pairs above the floor in both fits, the ln lift of the fit on the training part and of the fit on all baskets (the file written) correlate at {prior_stats['corr']:.3f}.")
    add("")
    rows = sorted(prior_stats["type_rows"], key=lambda r: (-r[0], r[1], r[2], r[3]))
    n = min(20, len(rows))
    add("## The 20 highest scoring type pairs (fit on all baskets)")
    add("")
    add("| Rank | Slot pair | Type pair | Score | ln lift | Baskets |")
    add("| --- | --- | --- | --- | --- | --- |")
    for k, (ln, sp_name, a, b, bk, _) in enumerate(rows[:n], 1):
        add(f"| {k} | {sp_name} | {a} + {b} | {1 / (1 + np.exp(-ln)):.3f} | {ln:+.3f} | {fmt(bk)} |")
    add("")
    add("## The 20 lowest scoring type pairs (fit on all baskets)")
    add("")
    add("| Rank | Slot pair | Type pair | Score | ln lift | Baskets |")
    add("| --- | --- | --- | --- | --- | --- |")
    low = sorted(prior_stats["type_rows"], key=lambda r: (r[0], r[1], r[2], r[3]))
    for k, (ln, sp_name, a, b, bk, _) in enumerate(low[:n], 1):
        add(f"| {k} | {sp_name} | {a} + {b} | {1 / (1 + np.exp(-ln)):.3f} | {ln:+.3f} | {fmt(bk)} |")
    add("")
    cr = ar["colour_readings"]
    add("## Colour and type map notes for the style specialist (FOI-11)")
    add("")
    add(f"- Maroon: the work order says Dark Red, LLD 7.8 says Red with perceived colour value Dark. Menswear articles with master Red: {fmt(cr['red_dark_red_group'])} in colour group Dark Red (used), {fmt(cr['red_value_dark'])} with value Dark, {fmt(cr['red_both'])} in both.")
    add(f"- Navy: Blue with perceived colour value Dark is used ({fmt(cr['blue_value_dark'])} Menswear articles); FDD FOI-11 words it as Dark Blue, the colour group, which would be {fmt(cr['blue_dark_blue_group'])}.")
    add("- Other shoe has no Sparta sub-type (FDD 14.3), so it is not in the prior although LLD 7.9 lists it under Footwear. Cardigan is Layer as in LLD 7.9 (the slot map allows Top or Layer). Sandals, Formal shoes, Chinos and Joggers cannot be expressed by the H&M types and are not in the prior; the committed fallback list covers them.")
    add("")
    add("## Known limits")
    add("")
    add("- Same-day purchases by one online customer are a weak sign of an outfit: people buy for others, buy several colours of one product, and buy only part of what they wear. The bootstrap interval covers sampling variation, not these.")
    add(f"- The data are H&M purchases from {rs['min_date']} to {rs['max_date']} by customers whose country the files do not state; they are not purchases by Indian men, and the pilot does not assume the prior transfers.")
    add("- H&M's Menswear range is small in footwear and layers, so the Bottom+Footwear and Layer+Top tables rest on fewer baskets than Top+Bottom.")
    add("- Popularity is controlled for in the test by drawing replacements by purchase frequency, but a real pair can be replaced by a combination that was in fact also bought together.")
    add("- The prior is a nudge of weight 0.15 on outfits that already pass R1 and R2; it never admits an outfit. Licence status: models and tables from these files may enter the pilot only after BRD OI-5 is closed.")
    add("")
    return "\n".join(L) + "\n"


def ps_days(sp_):
    return (np.datetime64(sp_["last_day"]) - np.datetime64(sp_["cutoff"])).astype(int)


def summarise_prior(run):
    vocab = run["vocab"]
    full_rows = type_pair_rows(run["full_prior"], vocab)
    train_rows = {(r[1], r[2], r[3]): r[0] for r in type_pair_rows(run["train_prior"], vocab)}
    both = [(r[0], train_rows[(r[1], r[2], r[3])]) for r in full_rows if (r[1], r[2], r[3]) in train_rows]
    colour_entries = int((run["full_prior"]["baskets_colour"] >= run["full_prior"]["min_baskets"]).sum())
    return {"type_rows": full_rows, "type_entries": len(full_rows), "colour_entries": colour_entries,
            "common": len(both), "corr": pearson([x[0] for x in both], [x[1] for x in both])}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--env-file", default=None, help="env file with the two settings (default: workflow/local.env found above this script)")
    ap.add_argument("--card", default=str(CARD_PATH), help="where to write the card (default: PRIOR_CARD.md next to this script)")
    ap.add_argument("--bootstrap", type=int, default=ev.N_BOOT)
    args = ap.parse_args(argv)
    run = load_and_fit(args.env_file, n_boot=args.bootstrap)
    out_dir = run["settings"][sparta_env.ARTIFACT_KEY]
    out_dir.mkdir(parents=True, exist_ok=True)
    prior_text = pl.prior_to_json(run["full_prior"], run["vocab"])
    unlock_text = pl.candidates_to_json(run["candidates"])
    (out_dir / PRIOR_NAME).write_text(prior_text, encoding="utf-8")
    (out_dir / UNLOCK_NAME).write_text(unlock_text, encoding="utf-8")
    card = render_card(run, pl.sha256_text(prior_text), pl.sha256_text(unlock_text), summarise_prior(run),
                       datetime.date.today().isoformat())
    Path(args.card).write_text(card, encoding="utf-8")
    e = run["evaluation"]["overall"]
    print(f"wrote {out_dir / PRIOR_NAME}, {out_dir / UNLOCK_NAME} and {args.card}")
    print(f"overall AUC {e['auc']:.4f} (95% {e['ci'][0]:.4f} to {e['ci'][1]:.4f}); "
          f"verdict {'ships' if e['auc'] >= ev.VERDICT_AUC else 'not shippable'}; {run['seconds'] / 60:.1f} minutes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
