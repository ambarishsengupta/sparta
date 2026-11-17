"""Train garment-cnn-v1 (LLD 7.7) on the 60,000 IDX training pictures only. The test pictures are never loaded here.

Stratified 54,000 / 6,000 split with a fixed seed, augmentation with torch tensor ops, Adam, label smoothing 0.1, up to
30 epochs, early stopping on validation accuracy (best weights kept), and a wall-clock time-box. Writes the checkpoint
to .cache/ (git-ignored) and workflow/evidence/R5/train_summary.json. Run: python train.py [--minutes 25] [--seed 20261104]
"""
import argparse
import json
import math
import time
from pathlib import Path

import numpy as np
import torch
from torch import nn
from torch.nn import functional as F

import idx
import model as M
import preprocess as pp

HERE = Path(__file__).resolve().parent
EVIDENCE = HERE.parents[2] / "workflow" / "evidence" / "R5"
CHECKPOINT = HERE / ".cache" / "garment-cnn-v1.pt"
AUG = {"p_geo": 0.5, "rot": 8, "shift": 1.5, "scale": 0.08, "p_bc": 0.3, "bright": 0.15, "contrast": 0.25, "p_blur": 0.1, "p_erase": 0.1}   # chosen on validation accuracy only
SETTINGS = {"optimizer": "Adam", "lr": 3e-3, "lr_schedule": "cosine to 1% over 30 epochs", "batch_size": 128, "label_smoothing": 0.1,
            "max_epochs": 30, "patience": 6, "val_per_class": 600, "aug_params": AUG,
            "augmentation": (f"rotation +-{AUG['rot']} deg, shift +-{AUG['shift']} px, scale {1 - AUG['scale']:.2f}-{1 + AUG['scale']:.2f} (p={AUG['p_geo']}); "
                             f"brightness +-{AUG['bright']} and contrast {1 - AUG['contrast']:.2f}-{1 + AUG['contrast']:.2f} (p={AUG['p_bc']}); "
                             f"3x3 Gaussian blur (p={AUG['p_blur']}); random erasing of one 3-9 px box (p={AUG['p_erase']})")}

def stratified_split(labels, val_per_class, seed):
    """Index arrays (train, validation); validation has `val_per_class` pictures of every label."""
    rng = np.random.RandomState(seed)
    val = np.concatenate([rng.permutation(np.flatnonzero(labels == c))[:val_per_class] for c in range(idx.CLASSES)])
    mask = np.zeros(len(labels), dtype=bool)
    mask[val] = True
    return np.flatnonzero(~mask), np.sort(val)

def load_training_data(root, seed, val_per_class=SETTINGS["val_per_class"]):
    images, labels = idx.load_split(root, "train")          # the only split this file ever reads
    tr, va = stratified_split(labels, val_per_class, seed)
    x = torch.from_numpy(pp.normalise(images))
    y = torch.from_numpy(labels.astype(np.int64))
    return x[tr], y[tr], x[va], y[va]

def augment(x, g):
    """Random per-picture augmentation of a (N, 1, 28, 28) batch in 0 to 1; black stays the background."""
    n = x.shape[0]
    u = lambda lo, hi: torch.rand(n, generator=g) * (hi - lo) + lo
    chance = lambda p: torch.rand(n, generator=g) < p
    on = chance(AUG['p_geo']).float()                                                     # geometry: rotate, scale, shift
    ang, sc = u(-AUG['rot'], AUG['rot']) * math.pi / 180 * on, 1 + (u(1 - AUG['scale'], 1 + AUG['scale']) - 1) * on
    tx, ty = u(-AUG['shift'], AUG['shift']) * on / 14, u(-AUG['shift'], AUG['shift']) * on / 14                              # 2 px = 2/14 of the half-width
    theta = torch.stack([torch.stack([ang.cos() / sc, -ang.sin() / sc, tx], 1), torch.stack([ang.sin() / sc, ang.cos() / sc, ty], 1)], 1)
    x = F.grid_sample(x, F.affine_grid(theta, list(x.shape), align_corners=False), padding_mode="zeros", align_corners=False)
    bc = chance(AUG['p_bc']).float().view(n, 1, 1, 1)                                    # brightness and contrast
    x = ((x - 0.5) * (1 + (u(1 - AUG['contrast'], 1 + AUG['contrast']) - 1).view(n, 1, 1, 1) * bc) + 0.5 + u(-AUG['bright'], AUG['bright']).view(n, 1, 1, 1) * bc).clamp(0, 1)
    k = torch.tensor([1.0, 2.0, 1.0]); k = (k[:, None] * k[None, :] / 16).view(1, 1, 3, 3)
    x = torch.where(chance(AUG['p_blur']).view(n, 1, 1, 1), F.conv2d(x, k, padding=1), x)  # blur
    ys, xs = torch.arange(28).view(1, 28, 1), torch.arange(28).view(1, 1, 28)    # random erasing
    h, w = (torch.randint(3, 10, (n,), generator=g).view(n, 1, 1) for _ in range(2))
    cy, cx = (torch.randint(0, 28, (n,), generator=g).view(n, 1, 1) for _ in range(2))
    box = ((ys - cy).abs() * 2 < h) & ((xs - cx).abs() * 2 < w) & chance(AUG['p_erase']).view(n, 1, 1)
    return x.masked_fill(box.unsqueeze(1), 0.0)

@torch.no_grad()
def accuracy(net, x, y):
    net.eval()
    return float(sum((net(x[i:i + 2000])[0].argmax(1) == y[i:i + 2000]).sum() for i in range(0, len(x), 2000)) / len(x))

def train(x_tr, y_tr, x_va, y_va, seed, max_epochs=SETTINGS["max_epochs"], patience=SETTINGS["patience"], budget_s=25 * 60, log=print):
    torch.manual_seed(seed)
    g = torch.Generator().manual_seed(seed)
    net = M.GarmentCNN()
    opt = torch.optim.Adam(net.parameters(), lr=SETTINGS["lr"])
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=SETTINGS["max_epochs"], eta_min=SETTINGS["lr"] * 0.01)
    loss_fn, bs, t0 = nn.CrossEntropyLoss(label_smoothing=SETTINGS["label_smoothing"]), SETTINGS["batch_size"], time.time()
    best, best_epoch, best_state, history, stopped = -1.0, 0, None, [], "max_epochs"
    for epoch in range(1, max_epochs + 1):
        net.train()
        order, total = torch.randperm(len(x_tr), generator=g), 0.0
        for i in range(0, len(order), bs):
            b = order[i:i + bs]
            loss = loss_fn(net(augment(x_tr[b], g))[0], y_tr[b])
            opt.zero_grad(); loss.backward(); opt.step()
            total += loss.item() * len(b)
        sched.step()
        val = accuracy(net, x_va, y_va)
        history.append({"epoch": epoch, "train_loss": round(total / len(x_tr), 4), "val_accuracy": round(val, 4), "seconds": round(time.time() - t0, 1)})
        log(f"epoch {epoch:2d}  train_loss {history[-1]['train_loss']:.4f}  val_acc {val:.4f}  elapsed {history[-1]['seconds']:.0f}s")
        if val > best:
            best, best_epoch, best_state = val, epoch, {k: v.clone() for k, v in net.state_dict().items()}
        if epoch - best_epoch >= patience:
            stopped = "early_stopping"
            break
        if time.time() - t0 >= budget_s and epoch < max_epochs:
            stopped = "time_box"
            break
    net.load_state_dict(best_state)
    return net, {"epochs_run": len(history), "best_epoch": best_epoch, "best_val_accuracy": round(best, 4), "stopped_by": stopped,
                 "train_seconds": round(time.time() - t0, 1), "history": history}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=20261104)
    ap.add_argument("--minutes", type=float, default=25)
    ap.add_argument("--threads", type=int, default=8)
    a = ap.parse_args()
    torch.set_num_threads(a.threads)
    x_tr, y_tr, x_va, y_va = load_training_data(idx.data_root(), a.seed)
    print(f"train {len(x_tr)} validation {len(x_va)} seed {a.seed} threads {a.threads} budget {a.minutes} min", flush=True)
    net, summary = train(x_tr, y_tr, x_va, y_va, a.seed, budget_s=a.minutes * 60, log=lambda s: print(s, flush=True))
    CHECKPOINT.parent.mkdir(exist_ok=True)
    torch.save(net.state_dict(), CHECKPOINT)
    summary.update(seed=a.seed, threads=a.threads, budget_minutes=a.minutes, train_size=len(x_tr), val_size=len(x_va), settings=SETTINGS, weights=M.weight_count(net))
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    (EVIDENCE / "train_summary.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")
    print(f"best epoch {summary['best_epoch']} val_acc {summary['best_val_accuracy']} stopped_by {summary['stopped_by']}; checkpoint {CHECKPOINT}")

if __name__ == "__main__":
    main()
