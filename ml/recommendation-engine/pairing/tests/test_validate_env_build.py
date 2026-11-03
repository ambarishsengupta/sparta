"""Validator, settings and an end-to-end build on synthetic CSV files (nothing from H&M)."""
import contextlib
import io
import json
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import synth  # noqa: F401  (sets sys.path)

import build_prior
import prior_lib as pl
import sparta_env
import validate_prior as vp

PAIRING = Path(synth.PAIRING)


def good_prior():
    return {"version": 1, "min_pairs": 30,
            "type_pairs": {"Top+Bottom": {"T-shirt": {"Jeans": 0.62, "Shorts": 0.4}}, "Layer+Top": {"Jacket": {"Shirt": 0.55}}},
            "colour_pairs": {"Top+Bottom": {"White": {"Navy": 0.58}}}}


def errors_for(doc):
    return vp.validate_text(json.dumps(doc))


class ValidatorTests(unittest.TestCase):
    def test_good_prior_and_good_unlock_list_pass(self):
        self.assertEqual(errors_for(good_prior()), [])
        self.assertEqual(errors_for([{"sub_type": "Chinos", "colour_family": "Khaki"}]), [])

    def test_bad_values_keys_and_fields_fail(self):
        def with_(mutate):
            d = good_prior()
            mutate(d)
            return errors_for(d)
        self.assertTrue(with_(lambda d: d["type_pairs"]["Top+Bottom"]["T-shirt"].update({"Jeans": 1.2})))      # range
        self.assertTrue(with_(lambda d: d["type_pairs"]["Top+Bottom"]["T-shirt"].update({"Jeans": -0.1})))
        self.assertTrue(with_(lambda d: d["type_pairs"]["Top+Bottom"].update({"Spaceship": {"Jeans": 0.5}})))  # not a sub-type
        self.assertTrue(with_(lambda d: d["colour_pairs"]["Top+Bottom"]["White"].update({"Puce": 0.5})))       # not a colour
        self.assertTrue(with_(lambda d: d["type_pairs"].update({"Top+Hat": {}})))                              # slot pair
        self.assertTrue(with_(lambda d: d["type_pairs"]["Top+Bottom"].update({"Jeans": {"T-shirt": 0.5}})))    # Jeans is no top
        self.assertTrue(with_(lambda d: d.update({"built": "now"})))                                           # extra field
        self.assertTrue(with_(lambda d: d.update({"min_pairs": 10})))
        self.assertTrue(errors_for([{"sub_type": "Jeans", "colour_family": "Puce"}]))
        self.assertTrue(errors_for([{"sub_type": "Jeans", "colour_family": "Navy", "n": 3}]))
        self.assertTrue(errors_for([{"sub_type": "Jeans", "colour_family": "Navy"}] * 2))                      # duplicate
        self.assertTrue(errors_for([{"sub_type": "Jeans", "colour_family": "Navy"}] * 41))                     # more than 40

    def test_dates_hashes_and_ids_anywhere_are_rejected(self):
        for text in ["2020-09-22", "a" * 64, "0123456789"]:
            d = good_prior()
            d["type_pairs"]["Top+Bottom"]["T-shirt"][text] = 0.5
            self.assertTrue(any("contains" in e for e in vp.validate_text(json.dumps(d))), text)
        self.assertEqual(len(vp.validate_text("{not json")), 1)

    def test_command_line_exit_codes(self):
        with tempfile.TemporaryDirectory() as tmp:
            ok, bad = Path(tmp) / "ok.json", Path(tmp) / "bad.json"
            ok.write_text(json.dumps(good_prior()))
            bad_doc = good_prior()
            bad_doc["colour_pairs"]["Top+Bottom"]["White"]["Navy"] = 7
            bad.write_text(json.dumps(bad_doc))
            run = lambda p: subprocess.run([sys.executable, str(PAIRING / "validate_prior.py"), str(p)], capture_output=True, text=True)
            self.assertEqual(run(ok).returncode, 0)
            self.assertEqual(run(bad).returncode, 1)
            self.assertEqual(run(Path(tmp) / "missing.json").returncode, 1)


class SettingsTests(unittest.TestCase):
    def test_env_file_is_parsed_and_the_environment_overrides_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            f = Path(tmp) / "local.env"
            f.write_text('# comment\nSPARTA_DATA_ROOT_HM="/data/H&M files"\nSPARTA_ARTIFACT_DIR=/art\nOTHER=1\n')
            s = sparta_env.load_settings(f, environ={})
            self.assertEqual(s[sparta_env.HM_KEY], Path("/data/H&M files"))
            self.assertEqual(s[sparta_env.ARTIFACT_KEY], Path("/art"))
            s = sparta_env.load_settings(f, environ={"SPARTA_ARTIFACT_DIR": "/other"})
            self.assertEqual(s[sparta_env.ARTIFACT_KEY], Path("/other"))
            self.assertEqual(s[sparta_env.HM_KEY], Path("/data/H&M files"))

    def test_missing_or_relative_settings_stop_the_run(self):
        with tempfile.TemporaryDirectory() as tmp:
            f = Path(tmp) / "local.env"
            f.write_text("SPARTA_DATA_ROOT_HM=/data\n")
            with self.assertRaises(SystemExit):
                sparta_env.load_settings(f, environ={})
            with self.assertRaises(SystemExit):
                sparta_env.load_settings(f, environ={"SPARTA_ARTIFACT_DIR": "relative/path"})

    def test_env_file_is_found_by_walking_up(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "workflow").mkdir()
            (Path(tmp) / "workflow" / "local.env").write_text("SPARTA_ARTIFACT_DIR=/x\n")
            deep = Path(tmp) / "a" / "b"
            deep.mkdir(parents=True)
            self.assertEqual(sparta_env.find_env_file(deep), (Path(tmp) / "workflow" / "local.env").resolve())


class EndToEndTests(unittest.TestCase):
    def write_inputs(self, folder):
        synth.articles().to_csv(folder / "articles.csv", index=False)
        cust = synth.customers(300, minors=[3])
        cust.assign(FN=1.0, postal_code="x").to_csv(folder / "customers.csv", index=False)
        tx = synth.planted_transactions(3000, associated=True, seed=21)
        tx.assign(price=0.01, sales_channel_id=2).to_csv(folder / "transactions_train.csv", index=False)

    def run_build(self, root, art, card):
        env = root / "local.env"
        env.write_text(f"SPARTA_DATA_ROOT_HM={root / 'hm'}\nSPARTA_ARTIFACT_DIR={art}\n")
        with contextlib.redirect_stdout(io.StringIO()):
            return build_prior.main(["--env-file", str(env), "--card", str(card), "--bootstrap", "30"])

    def test_build_writes_valid_identical_files_and_a_clean_card(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "hm").mkdir()
            self.write_inputs(root / "hm")
            outputs = []
            for run in range(2):
                art = root / f"art{run}"
                art.mkdir()
                self.assertEqual(self.run_build(root, art, root / f"card{run}.md"), 0)
                outputs.append((art / "pairing-prior-v1.json").read_bytes() + (art / "unlock-candidates.json").read_bytes())
            self.assertEqual(outputs[0], outputs[1])                       # byte-identical across runs
            art = root / "art0"
            for name in ("pairing-prior-v1.json", "unlock-candidates.json"):
                with contextlib.redirect_stdout(io.StringIO()):
                    self.assertEqual(vp.main([str(art / name)]), 0)
            self.assertEqual(sorted(p.name for p in art.iterdir()), ["pairing-prior-v1.json", "unlock-candidates.json"])
            self.assertEqual(sorted(p.name for p in (root / "hm").iterdir()), ["articles.csv", "customers.csv", "transactions_train.csv"])
            card = (root / "card0.md").read_text()
            self.assertRegex(card, r"Verdict: `(ships|not shippable)`")
            for needle in ("Overall", "Top+Bottom", "Bottom+Footwear", "Layer+Top", "SHA-256", "95% interval", "highest", "lowest"):
                self.assertIn(needle, card)
            self.assertIsNone(re.search(r"\b0\d{9}\b", card))              # no article id
            for text in ("T1", "C0001"):
                self.assertNotRegex(card, r"\b" + text + r"\b")
            self.assertIn(pl.sha256_file(root / "hm" / "articles.csv"), card)


if __name__ == "__main__":
    unittest.main()
