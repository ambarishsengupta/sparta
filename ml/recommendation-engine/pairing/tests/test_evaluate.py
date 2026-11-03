"""AUC with mid-ranks, the time split, negative draws and the customer bootstrap (synthetic data only)."""
import unittest

import synth  # noqa: F401  (sets sys.path)
import numpy as np

import evaluate_prior as ev
import prior_lib as pl


def pipeline(associated, seed):
    _, _, vocab, code_map, valid, _ = synth.setup()
    tx = synth.planted_transactions(4000, associated, seed=seed)
    index, minor = pl.minor_customers(synth.customers(300))
    lines, stats = pl.read_lines([tx], code_map, index, minor)
    pairs, _ = pl.build_pairs(lines, valid)
    cutoff = ev.split_dates(pl.date_to_days(stats["max_date"]))
    train, test = ev.split_pairs(pairs, cutoff)
    prior = pl.fit_prior(train, vocab.n_types, vocab.n_colours)
    freq = ev.test_frequency(lines, valid, vocab, cutoff)
    return vocab, lines, pairs, cutoff, train, test, prior, freq


class AucTests(unittest.TestCase):
    def test_auc_with_mid_ranks(self):
        self.assertEqual(ev.auc_midrank(np.array([3.0, 2.0]), np.array([2.0, 1.0])), 0.875)   # 3>2, 3>1, 2=2 (half), 2>1
        self.assertEqual(ev.auc_midrank(np.array([2.0, 3.0]), np.array([0.0, 1.0])), 1.0)
        self.assertEqual(ev.auc_midrank(np.array([0.5] * 4), np.array([0.5] * 6)), 0.5)          # all ties
        self.assertEqual(ev.auc_midrank(np.array([0.0]), np.array([1.0])), 0.0)

    def test_histogram_auc_equals_rank_auc(self):
        rng = np.random.default_rng(7)
        pos = rng.integers(0, 6, 200).astype(float)
        neg = rng.integers(0, 6, 300).astype(float)
        values, inverse = np.unique(np.concatenate([pos, neg]), return_inverse=True)
        ph = np.bincount(inverse[:200], minlength=len(values)).astype(float)
        nh = np.bincount(inverse[200:], minlength=len(values)).astype(float)
        self.assertAlmostEqual(ev.weighted_auc_from_hist(ph, nh), ev.auc_midrank(pos, neg), places=12)


class SplitAndDrawTests(unittest.TestCase):
    def test_last_eight_weeks_are_the_test_part(self):
        cutoff = ev.split_dates(1000)
        self.assertEqual(cutoff, 1000 - 56)
        pairs = synth.make_pairs([(0, 1, 1, cutoff, 0, 0, 0, 0), (0, 2, 2, cutoff + 1, 0, 0, 0, 0), (0, 3, 3, 1000, 0, 0, 0, 0)])
        train, test = ev.split_pairs(pairs, cutoff)
        self.assertEqual(train["basket"].tolist(), [1])
        self.assertEqual(sorted(test["basket"].tolist()), [2, 3])

    def test_negatives_come_from_the_second_slot_by_test_week_frequency_and_are_repeatable(self):
        vocab, lines, pairs, cutoff, train, test, prior, freq = pipeline(True, 5)
        t2n, c2n = ev.draw_negatives(test.sort_values(["sp", "basket"]), freq, vocab, seed=1)
        again = ev.draw_negatives(test.sort_values(["sp", "basket"]), freq, vocab, seed=1)
        self.assertTrue((t2n == again[0]).all() and (c2n == again[1]).all())
        sp = test.sort_values(["sp", "basket"])["sp"].to_numpy()
        for i, (_, second) in enumerate(pl.SLOT_PAIRS):
            allowed = {vocab.types[t] for t in range(vocab.n_types) if vocab.slot_of_type[vocab.types[t]] == second}
            if not (sp == i).any():                     # the planted data has no layers
                continue
            drawn = {vocab.types[t] for t in t2n[sp == i]}
            self.assertTrue(drawn and drawn <= allowed, (second, drawn))
        # a key never bought in the test weeks is never drawn: remove all Shorts purchases from the frequency table
        shorts = vocab.type_id["Shorts"]
        freq2 = freq.copy()
        freq2[pl.SLOTS.index("Bottom"), shorts * vocab.n_colours:(shorts + 1) * vocab.n_colours] = 0
        t2n2, _ = ev.draw_negatives(test.sort_values(["sp", "basket"]), freq2, vocab, seed=2)
        self.assertFalse((t2n2 == shorts).any())


class EvaluateTests(unittest.TestCase):
    def test_planted_association_is_found(self):
        vocab, lines, pairs, cutoff, train, test, prior, freq = pipeline(True, 11)
        result = ev.evaluate(prior, test, freq, vocab, n_boot=60)
        auc, (lo, hi) = result["overall"]["auc"], result["overall"]["ci"]
        self.assertGreater(auc, 0.60)             # only one of the three slot pairs carries the planted association
        self.assertLessEqual(lo, auc)
        self.assertGreaterEqual(hi, auc)
        self.assertEqual(result["overall"]["pairs"], len(test))
        self.assertEqual(set(result["by_slot_pair"]), set(pl.SLOT_PAIR_NAMES))
        self.assertGreater(result["by_slot_pair"]["Top+Bottom"]["auc"], 0.75)   # best possible is about 0.83: a random bottom is the real one a third of the time
        self.assertTrue(0.40 < result["by_slot_pair"]["Top+Footwear"]["auc"] < 0.60)

    def test_independent_baskets_score_near_chance(self):
        vocab, lines, pairs, cutoff, train, test, prior, freq = pipeline(False, 12)
        result = ev.evaluate(prior, test, freq, vocab, n_boot=60)
        self.assertTrue(0.40 < result["overall"]["auc"] < 0.60, result["overall"]["auc"])

    def test_bootstrap_is_repeatable_and_ordered(self):
        vocab, lines, pairs, cutoff, train, test, prior, freq = pipeline(True, 13)
        a = ev.evaluate(prior, test, freq, vocab, n_boot=40)
        b = ev.evaluate(prior, test, freq, vocab, n_boot=40)
        self.assertEqual(a["overall"], b["overall"])
        for r in [a["overall"]] + list(a["by_slot_pair"].values()):
            if "ci" in r:
                self.assertLessEqual(r["ci"][0], r["ci"][1])


if __name__ == "__main__":
    unittest.main()
