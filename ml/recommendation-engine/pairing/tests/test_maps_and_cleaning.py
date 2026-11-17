"""Type map, colour map, article classification and line cleaning (synthetic data only)."""
import unittest

import synth  # noqa: F401  (sets sys.path)
import numpy as np
import pandas as pd

import prior_lib as pl


class TypeMapTests(unittest.TestCase):
    def setUp(self):
        self.tm = pl.load_type_map()
        self.sub_types, self.colours, self.slots_of, self.category_of = pl.load_taxonomy()

    def test_every_sub_type_and_category_exists_in_the_taxonomy(self):
        entries = list(self.tm["types"].values()) + [self.tm["denim"]]
        for e in entries:
            if e["sub_type"] is not None:
                self.assertIn(e["sub_type"], self.sub_types)
                self.assertEqual(self.category_of[e["sub_type"]], e["category"])
            if e["prior_slot"] is not None:
                self.assertIn(e["prior_slot"], pl.SLOTS)
                if e["sub_type"] is not None:
                    self.assertIn(e["prior_slot"], self.slots_of[e["sub_type"]])

    def test_twenty_types_and_jeans_rule(self):
        self.assertEqual(len(self.tm["types"]) + 1, 20)   # nineteen product types plus Jeans (LLD 7.8)
        art = synth.articles().set_index("article_id")
        sub, slot = pl.map_sub_types(art, self.tm)
        self.assertEqual(sub["B1"], "Trousers")
        self.assertEqual(sub["B2"], "Jeans")
        self.assertEqual(slot["B2"], "Bottom")
        self.assertEqual(sub["T3"], "Polo")
        self.assertEqual(slot["L2"], "Layer")             # Cardigan is Layer in LLD 7.9
        self.assertIsNone(sub["F3"])                      # Other shoe has no Sparta sub-type
        self.assertIsNone(sub["W1"])                      # Dress is not in the table

    def test_colour_rules(self):
        cm = pl.load_colour_map()

        def fam(master, value="Medium", group="Black"):
            df = pd.DataFrame({"perceived_colour_master_name": [master], "perceived_colour_value_name": [value],
                               "colour_group_name": [group]})
            return pl.map_colour_families(df, cm).iloc[0]

        for plain in ["Black", "White", "Grey", "Beige", "Brown", "Red", "Orange", "Yellow", "Pink", "Green", "Blue"]:
            self.assertEqual(fam(plain), plain)
        self.assertEqual(fam("Blue", "Dark", "Dark Blue"), "Navy")
        self.assertEqual(fam("Blue", "Light", "Light Blue"), "Blue")
        self.assertEqual(fam("Red", "Dark", "Dark Red"), "Maroon")
        self.assertEqual(fam("Red", "Bright", "Red"), "Red")
        self.assertEqual(fam("Khaki green", "Dark", "Greenish Khaki"), "Olive")
        self.assertEqual(fam("Khaki green", "Dark", "Dark Green"), "Khaki")
        self.assertEqual(fam("Bluish Green"), "Teal")
        self.assertEqual(fam("Turquoise"), "Teal")
        self.assertEqual(fam("Yellowish Green"), "Green")
        self.assertEqual(fam("Lilac Purple"), "Purple")
        for excluded in ["Metal", "Mole", "Unknown", "undefined"]:
            self.assertIsNone(fam(excluded))

    def test_colour_map_families_exist_in_the_taxonomy(self):
        cm = pl.load_colour_map()
        families = set(cm["master_to_family"].values()) | {r["family"] for r in cm["rules"]}
        self.assertTrue(families <= set(self.colours), families - set(self.colours))
        self.assertTrue(set(cm["excluded_masters"]).isdisjoint(cm["master_to_family"]))

    def test_prepare_articles_keeps_only_usable_menswear(self):
        _, _, vocab, code_map, valid, stats = synth.setup()
        self.assertNotIn("W1", code_map)                  # Ladieswear is not Menswear
        for unusable in ("F3", "X1", "M1"):               # no sub-type, no slot, no colour family
            self.assertEqual(code_map[unusable], -1)
        usable = [a for a, c in code_map.items() if c >= 0]
        self.assertEqual(sorted(usable), ["B1", "B2", "B3", "F1", "F2", "L1", "L2", "T1", "T2", "T3"])
        self.assertEqual(stats["usable_articles"], 10)
        self.assertEqual(stats["menswear_articles"], 13)
        t1 = code_map["T1"]
        self.assertEqual(vocab.types[valid["type"][t1]], "T-shirt")
        self.assertEqual(vocab.colours[valid["colour"][t1]], "White")
        self.assertEqual(pl.SLOTS[valid["slot"][code_map["L2"]]], "Layer")


class CleaningTests(unittest.TestCase):
    def test_read_lines_drops_minors_unknown_customers_and_non_menswear_and_collapses_duplicates(self):
        _, _, vocab, code_map, valid, _ = synth.setup()
        cust = synth.customers(4, minors=[1], missing_age=[2])
        index, minor = pl.minor_customers(cust)
        rows = [
            ("2020-01-01", "C0000", "T1"), ("2020-01-01", "C0000", "T1"),   # duplicate line: units 2
            ("2020-01-01", "C0000", "B1"),
            ("2020-01-01", "C0001", "T1"),                                   # minor: dropped
            ("2020-01-02", "C0002", "T1"),                                   # missing age: kept
            ("2020-01-02", "C0003", "W1"),                                   # not Menswear
            ("2020-01-03", "C0003", "X1"),                                   # Menswear but no slot
            ("2020-01-03", "C0003", "M1"),                                   # Menswear but no colour family
            ("2020-01-03", "C9999", "T1"),                                   # customer not in customers.csv
        ]
        chunks = [pd.DataFrame(rows[:5], columns=["t_dat", "customer_id", "article_id"]),
                  pd.DataFrame(rows[5:], columns=["t_dat", "customer_id", "article_id"])]
        lines, stats = pl.read_lines(chunks, code_map, index, minor)
        self.assertEqual(stats["rows"], 9)
        self.assertEqual(stats["minor_rows"], 1)
        self.assertEqual(stats["unknown_customer_rows"], 1)
        self.assertEqual(stats["min_date"], "2020-01-01")
        self.assertEqual(stats["max_date"], "2020-01-03")
        self.assertEqual(len(lines), 3)
        self.assertEqual(sorted(lines["cust"].unique().tolist()), [0, 2])
        t1_units = lines[(lines["cust"] == 0) & (lines["art"] == code_map["T1"])]["units"].iloc[0]
        self.assertEqual(int(t1_units), 2)

    def test_date_to_days(self):
        self.assertEqual(pl.date_to_days("1970-01-02"), 1)
        self.assertEqual(pl.date_to_days("2020-09-22") - pl.date_to_days("2020-09-21"), 1)


if __name__ == "__main__":
    unittest.main()
