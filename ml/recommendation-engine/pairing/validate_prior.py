#!/usr/bin/env python3
"""Validate pairing-prior-v1.json or unlock-candidates.json (LLD 7.9, 7.8 "Delivery of the trained files").

    python3 validate_prior.py PATH_TO_JSON

Exit 0 when the file is valid, 1 otherwise (every problem is printed). Checks:
  * pairing prior: exactly the keys version, min_pairs, type_pairs, colour_pairs; version 1; min_pairs 30;
    slot-pair keys are the four known ones; every type key is a Sparta sub-type that can fill the slot
    in packages/taxonomy; every colour key is a Sparta colour family; every value is a number in 0..1.
  * unlock list: a list of at most 40 {sub_type, colour_family} objects with taxonomy values, no duplicates.
  * either file: no date or hash field, and no date, 64-character hash or 10-digit id anywhere in the text.
Only the standard library is used. The taxonomy files are read, never changed.
"""
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SLOT_PAIRS = {"Top+Bottom": ("Top", "Bottom"), "Top+Footwear": ("Top", "Footwear"),
              "Bottom+Footwear": ("Bottom", "Footwear"), "Layer+Top": ("Layer", "Top")}
PRIOR_KEYS = {"version", "min_pairs", "type_pairs", "colour_pairs"}
FORBIDDEN_KEYS = re.compile(r"date|hash|sha|built|time|stamp|created|customer|article|basket|count", re.I)
DATE_RE = re.compile(r"(?<!\d)\d{4}-\d{2}-\d{2}(?!\d)")
HEX_RE = re.compile(r"(?<![0-9a-fA-F])[0-9a-fA-F]{64}(?![0-9a-fA-F])")
ID_RE = re.compile(r"(?<!\d)\d{10}(?!\d)")
MAX_UNLOCK = 40


def find_taxonomy():
    for folder in [HERE] + list(HERE.parents):
        base = folder / "packages" / "taxonomy" / "src"
        if (base / "taxonomy.json").is_file() and (base / "slots.json").is_file():
            return json.loads((base / "taxonomy.json").read_text("utf-8")), json.loads((base / "slots.json").read_text("utf-8"))
    raise SystemExit("packages/taxonomy/src/taxonomy.json not found above this script")


def taxonomy_sets():
    tax, slots = find_taxonomy()
    subs = {s for c in tax["categories"] for s in c["subTypes"]}
    colours = {c["family"] for c in tax["colourFamilies"]}
    slots_of = {}
    for group in slots["groups"]:
        for member in group["members"]:
            names = next(c["subTypes"] for c in tax["categories"] if c["name"] == member["category"]) \
                if member["subTypes"] == "all" else member["subTypes"]
            for s in names:
                slots_of.setdefault(s, set()).update(group["slots"])
    return subs, colours, slots_of


def is_number(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool) and x == x


def check_text(text, errors):
    for label, rx in (("a date", DATE_RE), ("a 64-character hash", HEX_RE), ("a 10-digit number", ID_RE)):
        m = rx.search(text)
        if m:
            errors.append(f"the file contains {label}: {m.group(0)[:20]}")


def walk_keys(node, errors, path=""):
    if isinstance(node, dict):
        for k, v in node.items():
            if FORBIDDEN_KEYS.search(k) and k not in ("min_pairs",):
                errors.append(f"forbidden field name at {path}/{k}")
            walk_keys(v, errors, f"{path}/{k}")
    elif isinstance(node, list):
        for i, v in enumerate(node):
            walk_keys(v, errors, f"{path}[{i}]")


def check_table(table, name, names, slots_of, check_slot, errors):
    if not isinstance(table, dict):
        errors.append(f"{name} must be an object")
        return
    for sp, rows in table.items():
        if sp not in SLOT_PAIRS:
            errors.append(f"{name}: unknown slot pair {sp!r}")
            continue
        if not isinstance(rows, dict):
            errors.append(f"{name}.{sp} must be an object")
            continue
        first_slot, second_slot = SLOT_PAIRS[sp]
        for a, inner in rows.items():
            if a not in names:
                errors.append(f"{name}.{sp}: unknown key {a!r}")
            elif check_slot and first_slot not in slots_of.get(a, ()):
                errors.append(f"{name}.{sp}: {a!r} cannot fill the {first_slot} slot")
            if not isinstance(inner, dict):
                errors.append(f"{name}.{sp}.{a} must be an object")
                continue
            for b, v in inner.items():
                if b not in names:
                    errors.append(f"{name}.{sp}.{a}: unknown key {b!r}")
                elif check_slot and second_slot not in slots_of.get(b, ()):
                    errors.append(f"{name}.{sp}.{a}: {b!r} cannot fill the {second_slot} slot")
                if not is_number(v) or not 0 <= v <= 1:
                    errors.append(f"{name}.{sp}.{a}.{b}: value {v!r} is not a number in 0..1")


def validate_prior(doc, errors):
    subs, colours, slots_of = taxonomy_sets()
    if set(doc) != PRIOR_KEYS:
        errors.append(f"top-level keys must be exactly {sorted(PRIOR_KEYS)}, got {sorted(doc)}")
    if doc.get("version") != 1:
        errors.append(f"version must be 1, got {doc.get('version')!r}")
    if doc.get("min_pairs") != 30:
        errors.append(f"min_pairs must be 30, got {doc.get('min_pairs')!r}")
    check_table(doc.get("type_pairs"), "type_pairs", subs, slots_of, True, errors)
    check_table(doc.get("colour_pairs"), "colour_pairs", colours, slots_of, False, errors)


def validate_unlock(doc, errors):
    subs, colours, _ = taxonomy_sets()
    if len(doc) > MAX_UNLOCK:
        errors.append(f"at most {MAX_UNLOCK} entries allowed, got {len(doc)}")
    seen = set()
    for i, e in enumerate(doc):
        if not isinstance(e, dict) or set(e) != {"sub_type", "colour_family"}:
            errors.append(f"entry {i} must be an object with exactly sub_type and colour_family")
            continue
        if e["sub_type"] not in subs:
            errors.append(f"entry {i}: {e['sub_type']!r} is not a Sparta sub-type")
        if e["colour_family"] not in colours:
            errors.append(f"entry {i}: {e['colour_family']!r} is not a Sparta colour family")
        key = (e["sub_type"], e["colour_family"])
        if key in seen:
            errors.append(f"entry {i}: duplicate {key}")
        seen.add(key)


def validate_text(text):
    """Return the list of problems for the text of a prior or unlock file."""
    errors = []
    try:
        doc = json.loads(text)
    except ValueError as exc:
        return [f"not valid JSON: {exc}"]
    check_text(text, errors)
    walk_keys(doc, errors)
    if isinstance(doc, dict):
        validate_prior(doc, errors)
    elif isinstance(doc, list):
        validate_unlock(doc, errors)
    else:
        errors.append("the top level must be an object (prior) or a list (unlock candidates)")
    return errors


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) != 1:
        print(__doc__)
        return 2
    path = Path(argv[0])
    if not path.is_file():
        print(f"INVALID: file not found: {path}")
        return 1
    errors = validate_text(path.read_text(encoding="utf-8"))
    if errors:
        print(f"INVALID: {path.name}")
        for e in errors[:50]:
            print("  -", e)
        return 1
    print(f"OK: {path.name} is valid")
    return 0


if __name__ == "__main__":
    sys.exit(main())
