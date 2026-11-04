"""Evaluate garment-cnn-v1.onnx with onnxruntime on the 10,000 IDX test pictures (overall, per class, confusion matrix)
and write model_card.md from the real run. The test pictures are used here once, for the final report; nothing is
tuned on them. Run: python evaluate.py [--no-card]"""
import argparse
import hashlib
import json
import platform
import re
from importlib.metadata import version
from pathlib import Path

import numpy as np

import idx
import preprocess as pp
from export_onnx import ONNX_PATH, session
from train import EVIDENCE

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
README = REPO / "data" / "recommendation-engine" / "README.md"
CLASS_NAMES = [v["name"] for v in json.loads((HERE / "class_map.json").read_text(encoding="utf-8")).values()]

def evaluate(onnx_path, images, labels, batch=1000):
    """Run the ONNX file on uint8 pictures; accuracy overall and per class, confusion matrix (rows true, columns predicted)."""
    sess, x, pred = session(onnx_path), pp.normalise(images), []
    for i in range(0, len(x), batch):
        pred.append(sess.run(["scores"], {"input": x[i:i + batch]})[0].argmax(1))
    pred, labels = np.concatenate(pred), np.asarray(labels).astype(np.int64)
    confusion = np.zeros((idx.CLASSES, idx.CLASSES), dtype=np.int64)
    np.add.at(confusion, (labels, pred), 1)
    return {"count": len(labels), "accuracy": float((pred == labels).mean()), "per_class": [
        {"class": c, "name": CLASS_NAMES[c], "correct": int(confusion[c, c]), "total": int(confusion[c].sum()),
         "accuracy": float(confusion[c, c] / max(1, confusion[c].sum()))} for c in range(idx.CLASSES)], "confusion": confusion.tolist()}

def sha256_file(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def data_hashes(root, readme=README):
    """SHA-256 of the four IDX files; ValueError unless every one equals the value in data/recommendation-engine/README.md."""
    expected = dict(re.findall(r"`mnist/([\w-]+)`[^\n]*?`([0-9a-f]{64})`", Path(readme).read_text(encoding="utf-8")))
    found = {n: sha256_file(Path(root) / n) for pair in idx.FILES.values() for n in pair}
    bad = [n for n, h in found.items() if expected.get(n) != h]
    if bad:
        raise ValueError(f"SHA-256 differs from data/recommendation-engine/README.md (or is not listed) for: {', '.join(bad)}")
    return found

MIT = ("The MIT License (MIT). Copyright (c) 2017 Zalando SE, https://tech.zalando.com. Permission is hereby granted, free of charge, to any person "
       "obtaining a copy of this software and associated documentation files (the \"Software\"), to deal in the Software without restriction, including "
       "without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit "
       "persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice "
       "shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, "
       "EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO "
       "EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR "
       "OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.")

def render_card(c):
    """Model card text from a dict of real-run facts: train, export, evaluation, data (name to SHA-256), onnx_sha256, libs."""
    t, e, v, s = c["train"], c["export"], c["evaluation"], c["train"]["settings"]
    low = " **This is below the 0.85 floor: the model is weaker than planned and the numbers above must not be read as good enough.**" if v["accuracy"] < 0.85 else ""
    rows = "\n".join(f"| {p['class']} | {p['name']} | {p['correct']} / {p['total']} | {p['accuracy']:.4f} |" for p in v["per_class"])
    head = "| true \\ predicted | " + " | ".join(str(i) for i in range(idx.CLASSES)) + " |\n|---|" + "---|" * idx.CLASSES
    grid = "\n".join(f"| **{i} {CLASS_NAMES[i]}** | " + " | ".join(str(n) for n in row) + " |" for i, row in enumerate(v["confusion"]))
    files = "\n".join(f"| `{n}` | `{h}` |" for n, h in c["data"].items())
    off = sorted(((n, i, j) for i, row in enumerate(v["confusion"]) for j, n in enumerate(row) if i != j), reverse=True)[:3]
    pairs = "; ".join(f"{CLASS_NAMES[i]} as {CLASS_NAMES[j]} {n}" for n, i, j in off)
    libs = ", ".join(f"{k} {x}" for k, x in c["libs"].items())
    return f"""# Model card: garment-cnn-v1

**Status: the 100-photo team evaluation of LLD 7.7 is NOT done.** The confidence threshold is therefore only the documented default 0.6, not a measured value, and `GARMENT_GUESS_ENABLED` must stay false for any pilot until that evaluation is done (LOI-9). The accuracy below is on Fashion-MNIST studio pictures, not on phone photos.

**ONNX SHA-256:** `{c['onnx_sha256']}`

| Field | Value |
| --- | --- |
| Model version | garment-cnn-v1 (file `services/worker/models/garment-cnn-v1.onnx`, {e['bytes']:,} bytes, opset {e['opset']}) |
| Task | Ten broad garment types from a 28 by 28 greyscale picture, plus 32 shape numbers (`scores` then `shape` outputs) |
| Network | Three 3x3 conv blocks (16, 32, 64 channels, ReLU, 2x2 max pooling after the first two), global average pooling, dense 32 with ReLU, dense 10; {t['weights']:,} weights |
| Preprocessing | `preprocess.py` (LLD 7.7 steps 1 to 6), the same code for evaluation and the worker |

## Data and split

Fashion-MNIST IDX files only (the CSV copies are never read). SHA-256 of each file, equal to `data/recommendation-engine/README.md`:

| File | SHA-256 |
| --- | --- |
{files}

Split of the 60,000 IDX training pictures: {t['train_size']:,} training and {t['val_size']:,} validation, stratified by label, seed {t['seed']}. The 10,000 IDX test pictures were used only for this report and for the 100-picture export check.

## Training settings

Optimiser {s['optimizer']}, learning rate {s['lr']} ({s['lr_schedule']}), batch size {s['batch_size']}, cross-entropy with label smoothing {s['label_smoothing']}, up to {s['max_epochs']} epochs, early stopping on validation accuracy with patience {s['patience']} (best weights kept), time-box {t['budget_minutes']:g} minutes. Augmentation: {s['augmentation']}. Augmentation strength and learning rate were chosen by comparing full runs on the validation split only (`workflow/evidence/R5/tuning-notes.txt`); the test pictures played no part.

Result of the run: {t['epochs_run']} epochs run, best epoch {t['best_epoch']}, validation accuracy {t['best_val_accuracy']:.4f}, stopped by {t['stopped_by']}, {t['train_seconds']:.0f} seconds on {t['threads']} CPU threads.

Libraries: Python {platform.python_version()}, {libs}. Licences: PyTorch BSD-3, NumPy BSD-3, ONNX Apache-2.0, ONNX Runtime MIT, Pillow HPND.

## Export check

onnxruntime against PyTorch on {e['check_pictures']} test pictures, both outputs: largest absolute difference {e['max_abs_difference']:.3g} (tolerance {e['tolerance']:g}).

## Test results (10,000 IDX test pictures, run with onnxruntime)

**Overall accuracy: {v['accuracy']:.4f}** ({round(v['accuracy'] * v['count']):,} of {v['count']:,}).{low}

| Class | Name | Correct | Accuracy |
| --- | --- | --- | --- |
{rows}

Confusion matrix (rows are the true class, columns the predicted class):

{head}
{grid}

## Known limits

- Trained on greyscale studio pictures of single garments; phone photos (backgrounds, shadows, folds, hangers, hands) differ and accuracy there is not measured.
- White and very light garments come out dark and faint after inversion (as in the original data).
- Most frequent mistakes in this test run (true class as predicted class, count): {pairs}.
- Ten broad types only: Dress has no mapping, and sub-types such as Jeans, Shorts, Kurta or Blazer cannot be named.
- Not trained or tested on any H&M data, team photo or participant data.

## Citation and licence

Xiao, H., Rasul, K. and Vollgraf, R. (2017). Fashion-MNIST: a Novel Image Dataset for Benchmarking Machine Learning Algorithms. arXiv:1708.07747.

{MIT}
"""

def build_card(root, onnx_path=ONNX_PATH, evidence=EVIDENCE, out=HERE / "model_card.md", readme=README):
    load = lambda n: json.loads((Path(evidence) / n).read_text(encoding="utf-8"))
    libs = {k: version(k) for k in ("torch", "numpy", "onnx", "onnxruntime", "pillow")}
    sha = sha256_file(onnx_path)
    export = load("export_summary.json")
    if export["sha256"] != sha:
        raise ValueError("export_summary.json was written for a different ONNX file; run export_onnx.py again")
    card = render_card({"train": load("train_summary.json"), "export": export, "evaluation": load("evaluate_summary.json"), "data": data_hashes(root, readme),
                        "onnx_sha256": sha, "libs": libs})
    Path(out).write_text(card, encoding="utf-8")
    return card

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-card", action="store_true")
    a = ap.parse_args()
    root = idx.data_root()
    images, labels = idx.load_split(root, "test")
    result = evaluate(ONNX_PATH, images, labels)
    print(f"test pictures {result['count']}  overall accuracy {result['accuracy']:.4f}")
    for p in result["per_class"]:
        print(f"  {p['class']} {p['name']:<12} {p['correct']:>4}/{p['total']}  {p['accuracy']:.4f}")
    print("confusion matrix (rows true, columns predicted):")
    for row in result["confusion"]:
        print("  " + " ".join(f"{n:4d}" for n in row))
    (EVIDENCE / "evaluate_summary.json").write_text(json.dumps(result, indent=1), encoding="utf-8")
    if not a.no_card:
        build_card(root)
        print(f"wrote {HERE / 'model_card.md'}")

if __name__ == "__main__":
    main()
