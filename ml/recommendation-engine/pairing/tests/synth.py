"""Tiny synthetic data for the tests. Nothing here comes from H&M: every id and value is made up."""
import sys
from pathlib import Path

PAIRING = Path(__file__).resolve().parents[1]
if str(PAIRING) not in sys.path:
    sys.path.insert(0, str(PAIRING))

import numpy as np          # noqa: E402
import pandas as pd         # noqa: E402

import prior_lib as pl      # noqa: E402

COLS = ["article_id", "product_type_name", "garment_group_name", "index_group_name", "colour_group_name",
        "perceived_colour_master_name", "perceived_colour_value_name"]

# id, product type, garment group, index group, colour group, master colour, value
ROWS = [
    ("T1", "T-shirt", "Jersey Basic", "Menswear", "White", "White", "Light"),            # Top, White
    ("T2", "Shirt", "Shirts", "Menswear", "Dark Blue", "Blue", "Dark"),                  # Top, Navy
    ("T3", "Polo shirt", "Jersey Fancy", "Menswear", "Dark Red", "Red", "Dark"),         # Top, Maroon
    ("B1", "Trousers", "Trousers", "Menswear", "Black", "Black", "Dark"),                # Bottom, Black
    ("B2", "Trousers", "Trousers Denim", "Menswear", "Dark Blue", "Blue", "Dark"),       # Bottom, Jeans, Navy
    ("B3", "Shorts", "Shorts", "Menswear", "Beige", "Beige", "Light"),                   # Bottom, Beige
    ("F1", "Sneakers", "Shoes", "Menswear", "White", "White", "Light"),                  # Footwear, White
    ("F2", "Boots", "Shoes", "Menswear", "Black", "Black", "Dark"),                      # Footwear, Black
    ("F3", "Other shoe", "Shoes", "Menswear", "Black", "Black", "Dark"),                 # no sub-type
    ("L1", "Jacket", "Jackets", "Menswear", "Black", "Black", "Dark"),                   # Layer, Black
    ("L2", "Cardigan", "Knitwear", "Menswear", "Grey", "Grey", "Medium"),                # Layer, Grey
    ("X1", "Bag", "Accessories", "Menswear", "Black", "Black", "Dark"),                  # no slot
    ("M1", "T-shirt", "Jersey Basic", "Menswear", "Beige", "Mole", "Medium"),            # colour with no family
    ("W1", "Dress", "Dresses", "Ladieswear", "Black", "Black", "Dark"),                  # not Menswear
]


def articles():
    return pd.DataFrame(ROWS, columns=COLS)


def setup():
    type_map, colour_map = pl.load_type_map(), pl.load_colour_map()
    _, colours, _, _ = pl.load_taxonomy()
    vocab = pl.Vocab(type_map, colours)
    code_map, valid, stats = pl.prepare_articles(articles(), type_map, colour_map, vocab)
    return type_map, colour_map, vocab, code_map, valid, stats


def customers(n, minors=(), missing_age=()):
    ages = [30] * n
    for i in minors:
        ages[i] = 16
    ids = [f"C{i:04d}" for i in range(n)]
    df = pd.DataFrame({"customer_id": ids, "age": ages})
    for i in missing_age:
        df.loc[i, "age"] = np.nan
    return df


def planted_transactions(n_baskets, associated, seed=1, n_customers=300, n_days=120, start="2020-01-01"):
    """Baskets of a top, a bottom and footwear. With `associated` the bottom follows the top; else it is random."""
    rng = np.random.default_rng(seed)
    tops, bottoms, shoes = ["T1", "T2", "T3"], ["B1", "B2", "B3"], ["F1", "F2"]
    day0 = np.datetime64(start)
    rows = []
    for _ in range(n_baskets):
        c = f"C{int(rng.integers(0, n_customers)):04d}"
        d = str(day0 + int(rng.integers(0, n_days)))
        i = int(rng.integers(0, 3))
        j = i if associated else int(rng.integers(0, 3))
        s = int(rng.integers(0, 2))
        for a in (tops[i], bottoms[j], shoes[s]):
            rows.append((d, c, a))
    return pd.DataFrame(rows, columns=["t_dat", "customer_id", "article_id"])


def make_pairs(rows):
    """rows: (sp, basket, cust, date, t1, c1, t2, c2) tuples -> a pairs frame."""
    df = pd.DataFrame(rows, columns=["sp", "basket", "cust", "date", "t1", "c1", "t2", "c2"])
    return df.astype({"sp": np.int8, "basket": np.int64, "cust": np.int64, "date": np.int64,
                      "t1": np.int16, "c1": np.int16, "t2": np.int16, "c2": np.int16})
