"""Basket pairs, lift scores, the floor, clipping and the JSON text (synthetic data only)."""
import json
import unittest

import synth  # noqa: F401  (sets sys.path)
import numpy as np
import pandas as pd

import prior_lib as pl


def lines_from(code_map, rows):
    """rows: (cust, date, article text, units) -> a lines frame."""
    return pd.DataFrame([(c, d, code_map[a], u) for c, d, a, u in rows], columns=["cust", "date", "art", "units"]).astype(np.int64)


class PairTests(unittest.TestCase):
    def setUp(self):
        _, _, self.vocab, self.code_map, self.valid, _ = synth.setup()

    def test_full_outfit_basket_gives_the_four_slot_pairs_once_whatever_the_quantity(self):
        lines = lines_from(self.code_map, [(0, 100, "T1", 5), (0, 100, "B2", 1), (0, 100, "F1", 3), (0, 100, "L1", 2)])
        pairs, stats = pl.build_pairs(lines, self.valid)
        self.assertEqual(len(pairs), 4)
        self.assertEqual(sorted(pairs["sp"].tolist()), [0, 1, 2, 3])
        self.assertEqual(stats["baskets_kept"], 1)
        self.assertEqual(stats["pairs_by_slot_pair"], {"Top+Bottom": 1, "Top+Footwear": 1, "Bottom+Footwear": 1, "Layer+Top": 1})
        top_bottom = pairs[pairs["sp"] == 0].iloc[0]
        self.assertEqual(self.vocab.types[top_bottom["t1"]], "T-shirt")
        self.assertEqual(self.vocab.types[top_bottom["t2"]], "Jeans")
        layer_top = pairs[pairs["sp"] == 3].iloc[0]
        self.assertEqual(self.vocab.types[layer_top["t1"]], "Jacket")     # the layer is the first item
        self.assertEqual(self.vocab.types[layer_top["t2"]], "T-shirt")

    def test_same_slot_items_form_no_pair_and_other_baskets_do_not_mix(self):
        lines = lines_from(self.code_map, [
            (0, 100, "T1", 1), (0, 100, "T2", 1),        # two tops in one basket: no pair
            (0, 101, "B1", 1),                           # same customer, next day: separate basket
            (1, 100, "B1", 1),                           # other customer, same day: separate basket
            (2, 100, "T1", 1), (2, 100, "B1", 1), (2, 100, "B3", 1)])   # one top, two bottoms: two pairs
        pairs, stats = pl.build_pairs(lines, self.valid)
        self.assertEqual(len(pairs), 2)
        self.assertEqual(set(pairs["cust"]), {2})
        self.assertEqual(stats["baskets_with_usable_article"], 4)
        self.assertEqual(stats["baskets_kept"], 2)
        self.assertEqual(stats["baskets_with_pair"], 1)


class ScoreTests(unittest.TestCase):
    def fit(self, rows, n=14):
        return pl.fit_prior(synth.make_pairs(rows), n, 18)

    def test_lift_matches_hand_computation(self):
        # 2 x 2 counts [[400, 100], [100, 400]], one pair per basket: N=1000, n_a=n_b=500, E=250 everywhere
        rows, b = [], 0
        for (t1, t2), n in {(0, 0): 400, (0, 1): 100, (1, 0): 100, (1, 1): 400}.items():
            for _ in range(n):
                rows.append((0, b, b, 10, t1, 0, t2, 0))
                b += 1
        prior = self.fit(rows)
        self.assertAlmostEqual(prior["ln_type"][0, 0, 0], np.log((400 + 5) / (250 + 5)), places=9)
        self.assertAlmostEqual(prior["ln_type"][0, 0, 1], np.log((100 + 5) / (250 + 5)), places=9)
        self.assertEqual(prior["ln_type"][0, 2, 2], 0.0)                                           # never seen
        # colour pairs here are all (0, 0): lift (1000 + 5) / (1000 + 5) = 1, so ln lift 0
        self.assertAlmostEqual(prior["ln_colour"][0, 0, 0], 0.0, places=9)
        self.assertAlmostEqual(float(pl.score_pairs(prior, 0, 0, 0, 0, 0)), 1 / (1 + np.exp(-np.log(405 / 255))), places=9)

    def test_pair_seen_in_fewer_than_30_baskets_is_neutral_even_with_many_pairs(self):
        # background of 200 baskets that fill the table, then pair (3, 4) in 29 baskets with 5 pairs each
        rows = [(0, b, b, 10, 0, 0, 1, 0) for b in range(200)]
        b = 1000
        for _ in range(29):
            for _ in range(5):
                rows.append((0, b, b, 10, 3, 0, 4, 0))
            b += 1
        prior = self.fit(rows)
        self.assertEqual(prior["baskets_type"][0, 3, 4], 29)
        self.assertEqual(prior["pairs_type"][0, 3, 4], 145)
        self.assertEqual(prior["ln_type"][0, 3, 4], 0.0)
        rows += [(0, b, b, 10, 3, 0, 4, 0)]                  # a thirtieth basket
        prior = self.fit(rows)
        self.assertEqual(prior["baskets_type"][0, 3, 4], 30)
        self.assertNotEqual(prior["ln_type"][0, 3, 4], 0.0)

    def test_ln_lift_is_clipped_to_two(self):
        # ten types perfectly associated with ten others: lift (1000 + 5) / (100 + 5) = 9.6, ln 2.26 -> 2
        rows, b = [], 0
        for t in range(10):
            for _ in range(1000):
                rows.append((0, b, b, 10, t, 0, t, 0))
                b += 1
        prior = self.fit(rows)
        self.assertEqual(prior["ln_type"][0, 3, 3], 2.0)
        self.assertEqual(prior["ln_type"].max(), 2.0)
        # and from below: types 3 and 4 are each paired 10,000 times with themselves, and 30 times with each
        # other: lift (30 + 5) / (5022 + 5) = 0.007, ln -4.97 -> -2
        rows, b = [], 0
        for t in (3, 4):
            for _ in range(10000):
                rows.append((0, b, b, 10, t, 0, t, 0))
                b += 1
        for _ in range(30):
            rows.append((0, b, b, 10, 3, 0, 4, 0))
            b += 1
        prior = self.fit(rows)
        self.assertEqual(prior["baskets_type"][0, 3, 4], 30)
        self.assertEqual(prior["ln_type"][0, 3, 4], -2.0)
        self.assertTrue(prior["ln_type"].max() <= 2.0 and prior["ln_type"].min() >= -2.0)

    def test_unseen_pair_scores_one_half(self):
        prior = self.fit([(0, 0, 0, 10, 0, 0, 1, 0)])
        self.assertEqual(float(pl.score_pairs(prior, 1, 5, 5, 6, 6)), 0.5)

    def test_json_is_byte_identical_valid_and_free_of_ids(self):
        _, _, vocab, code_map, valid, _ = synth.setup()
        tx = synth.planted_transactions(1500, associated=True, seed=3)
        cust = synth.customers(300)
        index, minor = pl.minor_customers(cust)
        lines, _ = pl.read_lines([tx], code_map, index, minor)
        pairs, _ = pl.build_pairs(lines, valid)
        texts = [pl.prior_to_json(pl.fit_prior(pairs, vocab.n_types, vocab.n_colours), vocab) for _ in range(2)]
        self.assertEqual(texts[0], texts[1])
        doc = json.loads(texts[0])
        self.assertEqual(set(doc), {"version", "min_pairs", "type_pairs", "colour_pairs"})
        self.assertEqual(doc["min_pairs"], 30)
        self.assertIn("T-shirt", doc["type_pairs"]["Top+Bottom"])
        values = [v for sp in doc["type_pairs"].values() for row in sp.values() for v in row.values()]
        self.assertTrue(values and all(0 <= v <= 1 for v in values))
        self.assertNotIn("T1", texts[0])                       # no article text
        self.assertNotIn("C0001", texts[0])                    # no customer text
        import validate_prior
        self.assertEqual(validate_prior.validate_text(texts[0]), [])

    def test_unlock_candidates_are_ordered_by_count_then_name_and_capped(self):
        _, _, vocab, code_map, valid, _ = synth.setup()
        rows = [(i, 10, "T1", 3) for i in range(2)] + [(i, 10, "B1", 4) for i in range(2)] + [(5, 10, "T2", 1), (6, 10, "B3", 1)]
        lines = lines_from(code_map, rows)
        got = pl.unlock_candidates(lines, valid, vocab)
        self.assertEqual(got[0], {"sub_type": "Trousers", "colour_family": "Black"})   # 8 units
        self.assertEqual(got[1], {"sub_type": "T-shirt", "colour_family": "White"})    # 6 units
        self.assertEqual(got[2:], [{"sub_type": "Shirt", "colour_family": "Navy"},     # ties at 1 unit: by name
                                   {"sub_type": "Shorts", "colour_family": "Beige"}])
        self.assertEqual(len(pl.unlock_candidates(lines, valid, vocab, limit=3)), 3)
        self.assertTrue(all(set(e) == {"sub_type", "colour_family"} for e in got))


if __name__ == "__main__":
    unittest.main()
