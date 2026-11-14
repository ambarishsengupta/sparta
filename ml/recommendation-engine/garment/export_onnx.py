"""Export the trained network to services/worker/models/garment-cnn-v1.onnx (two outputs, "scores" then "shape") and
check onnxruntime against PyTorch on 100 IDX test pictures (tolerance 1e-4). Run: python export_onnx.py"""
import hashlib
import json
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
import torch

import idx
import model as M
import preprocess as pp
from train import CHECKPOINT, EVIDENCE

REPO = Path(__file__).resolve().parents[3]
ONNX_PATH = REPO / "services" / "worker" / "models" / "garment-cnn-v1.onnx"
OPSET, TOLERANCE, MAX_BYTES = 17, 1e-4, 1_000_000

def export(net, path):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    net.eval()
    torch.onnx.export(M.ExportCNN(net).eval(), torch.zeros(1, 1, 28, 28), str(path), input_names=["input"], output_names=M.OUTPUT_NAMES,
                      dynamic_axes={"input": {0: "batch"}, "scores": {0: "batch"}, "shape": {0: "batch"}}, opset_version=OPSET, dynamo=False)
    onnx.checker.check_model(onnx.load(str(path), load_external_data=False))
    return path

def session(path):
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = 1
    return ort.InferenceSession(str(path), opts, providers=["CPUExecutionProvider"])

def max_difference(net, path, x):
    """Largest absolute difference between onnxruntime and PyTorch over both outputs, for the (N, 1, 28, 28) float32 array x."""
    sess = session(path)
    assert [o.name for o in sess.get_outputs()] == M.OUTPUT_NAMES, "output order changed"
    got = sess.run(None, {"input": x})
    with torch.no_grad():
        want = M.ExportCNN(net).eval()(torch.from_numpy(x))
    return max(float(np.abs(g - w.numpy()).max()) for g, w in zip(got, want))

def main():
    net = M.GarmentCNN()
    net.load_state_dict(torch.load(CHECKPOINT, weights_only=True))
    path = export(net, ONNX_PATH)
    images, _ = idx.load_split(idx.data_root(), "test")      # used for the export check only, never for any model choice
    diff = max_difference(net, path, pp.normalise(images[:100]))
    data, size = path.read_bytes(), path.stat().st_size
    summary = {"path": "services/worker/models/garment-cnn-v1.onnx", "bytes": size, "sha256": hashlib.sha256(data).hexdigest(), "opset": OPSET,
               "outputs": M.OUTPUT_NAMES, "check_pictures": 100, "max_abs_difference": diff, "tolerance": TOLERANCE}
    print(json.dumps(summary, indent=1))
    assert size < MAX_BYTES, f"{size} bytes is not under 1 MB"
    assert diff <= TOLERANCE, f"onnxruntime differs from PyTorch by {diff} (> {TOLERANCE})"
    (EVIDENCE / "export_summary.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")
    print(f"export OK: {size} bytes, max |onnxruntime - PyTorch| = {diff:.3g} on 100 test pictures")

if __name__ == "__main__":
    main()
