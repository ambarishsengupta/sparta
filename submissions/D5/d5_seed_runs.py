"""D5 repeated-run check: retrain garment-cnn-v1 with the settings of ml/recommendation-engine/garment/train.py and one seed,
then score the 10,000 IDX test pictures once. Writes evidence/seed_<seed>.json (test predictions and top scores, no pictures).
The seed changes the 54,000 / 6,000 split, the initial weights, the batch order and the augmentation draws.
Run: python d5_seed_runs.py --seed 1 [--threads 2]   (seed 20261104 repeats the released run)"""
import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
import torch

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "ml" / "recommendation-engine" / "garment"))
import idx            # noqa: E402
import preprocess as pp   # noqa: E402
import train as T     # noqa: E402

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, required=True)
    ap.add_argument("--threads", type=int, default=2)
    ap.add_argument("--minutes", type=float, default=90)     # long time-box so no run is cut short; stopped_by is recorded
    a = ap.parse_args()
    torch.set_num_threads(a.threads)
    root = idx.data_root()
    x_tr, y_tr, x_va, y_va = T.load_training_data(root, a.seed)     # reads the IDX training file only
    net, summary = T.train(x_tr, y_tr, x_va, y_va, a.seed, budget_s=a.minutes * 60, log=lambda s: print(s, flush=True))
    images, labels = idx.load_split(root, "test")                   # the test pictures are loaded only after training has finished
    net.eval()
    with torch.no_grad():
        probs = torch.softmax(net(torch.from_numpy(pp.normalise(images)))[0], dim=1).numpy()
    out = {"seed": a.seed, "best_epoch": summary["best_epoch"], "epochs_run": summary["epochs_run"], "stopped_by": summary["stopped_by"],
           "val_accuracy": summary["best_val_accuracy"], "train_seconds": summary["train_seconds"],
           "test_accuracy": float((probs.argmax(1) == labels).mean()),
           "pred": probs.argmax(1).tolist(), "conf": [round(float(v), 4) for v in probs.max(1)]}
    path = Path(__file__).resolve().parent / "evidence" / f"seed_{a.seed}.json"
    path.write_text(json.dumps(out), encoding="utf-8")
    print(f"seed {a.seed} val {out['val_accuracy']} test {out['test_accuracy']:.4f} wrote {path}")

if __name__ == "__main__":
    main()
