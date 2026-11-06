"""Garment model v1 (LLD 7.7): one onnxruntime CPU session with one thread, created once. Result shape per LLD 7.3 step 7."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image

from .preprocess import preprocess

MODEL_VERSION = "garment-cnn-v1"
CLASSES = 10
SHAPE_NUMBERS = 32
HERE = Path(__file__).resolve().parent
DEFAULT_MODEL = HERE.parents[1] / "models" / "garment-cnn-v1.onnx"


class GarmentModel:
    def __init__(self, model_path: Path = DEFAULT_MODEL, class_map_path: Path = HERE / "class_map.json", min_confidence: float = 0.6):
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = 1
        opts.inter_op_num_threads = 1
        self._session = ort.InferenceSession(str(model_path), opts, providers=["CPUExecutionProvider"])
        self._input = self._session.get_inputs()[0].name
        self._class_map = json.loads(Path(class_map_path).read_text())
        self.min_confidence = min_confidence

    def infer(self, cutout: Image.Image) -> dict:
        """`category` and `sub_type` only when p >= min_confidence and the class has a mapping (Dress has none); the embedding always."""
        scores, shape = self._session.run(None, {self._input: preprocess(cutout)})
        scores, shape = scores[0], shape[0]
        if scores.shape != (CLASSES,) or shape.shape != (SHAPE_NUMBERS,) or not np.isfinite(scores).all() or not np.isfinite(shape).all():
            raise ValueError("unexpected model output")
        cls = int(np.argmax(scores))
        p = float(scores[cls])
        entry = self._class_map[str(cls)]
        confident = p >= self.min_confidence
        return {
            "model_version": MODEL_VERSION, "class": cls, "p": round(p, 6),
            "category": entry["category"] if confident else None,
            "sub_type": entry["sub_type"] if confident else None,
            "embedding": [round(float(v), 6) for v in shape],
        }
