"""IDX reader for the Fashion-MNIST files (LLD 7.7). Only the four IDX files are ever read, never the CSV files.

Checks the magic number, dimensions, picture size, item count and payload length; raises IdxError (a ValueError)
on any mismatch. The data folder comes from SPARTA_DATA_ROOT_MNIST: the process environment overrides the first
workflow/local.env found by walking up from this file (as in the pairing scripts).
"""
import os
import struct
from pathlib import Path

import numpy as np

IMAGES_MAGIC = 2051      # 0x00000803: unsigned byte data, 3 dimensions (count, rows, columns)
LABELS_MAGIC = 2049      # 0x00000801: unsigned byte data, 1 dimension (count)
SIDE = 28
CLASSES = 10
DATA_ROOT_KEY = "SPARTA_DATA_ROOT_MNIST"
FILES = {"train": ("train-images-idx3-ubyte", "train-labels-idx1-ubyte"),
         "test": ("t10k-images-idx3-ubyte", "t10k-labels-idx1-ubyte")}

class IdxError(ValueError):
    """The file is not a valid Fashion-MNIST IDX file."""

def _read(path, magic, ndim, count):
    data = Path(path).read_bytes()
    head = 4 * (1 + ndim)
    if len(data) < head:
        raise IdxError(f"{path}: truncated header ({len(data)} bytes, need {head})")
    found = struct.unpack(">" + "I" * (1 + ndim), data[:head])
    if found[0] != magic:
        raise IdxError(f"{path}: bad magic number {found[0]:#010x}, expected {magic:#010x}")
    dims = found[1:]
    if count is not None and dims[0] != count:
        raise IdxError(f"{path}: header says {dims[0]} items, expected {count}")
    if ndim == 3 and dims[1:] != (SIDE, SIDE):
        raise IdxError(f"{path}: pictures are {dims[1]} by {dims[2]}, expected {SIDE} by {SIDE}")
    size = int(np.prod(dims, dtype=np.int64))
    if len(data) - head != size:
        raise IdxError(f"{path}: payload is {len(data) - head} bytes, header implies {size}")
    return np.frombuffer(data, dtype=np.uint8, count=size, offset=head).reshape(dims)

def read_images(path, count=None):
    """uint8 array of shape (count, 28, 28)."""
    return _read(path, IMAGES_MAGIC, 3, count)

def read_labels(path, count=None):
    """uint8 array of shape (count,) with values 0 to 9."""
    labels = _read(path, LABELS_MAGIC, 1, count)
    if labels.size and int(labels.max()) >= CLASSES:
        raise IdxError(f"{path}: label {int(labels.max())} is outside 0 to {CLASSES - 1}")
    return labels

def load_split(root, split):
    """Read 'train' or 'test' from the folder `root`; the picture and label counts must agree."""
    images = read_images(Path(root) / FILES[split][0])
    return images, read_labels(Path(root) / FILES[split][1], count=len(images))

def find_env_file(start=None):
    here = Path(start if start is not None else __file__).resolve()
    return next((f / "workflow" / "local.env" for f in [here] + list(here.parents) if (f / "workflow" / "local.env").is_file()), None)

def data_root(env_file=None, environ=None):
    """The Fashion-MNIST folder as an absolute Path; SystemExit with a clear message if unset or relative."""
    value = (os.environ if environ is None else environ).get(DATA_ROOT_KEY, "")
    path = Path(env_file) if env_file else find_env_file()
    if not value and path is not None:
        if not path.is_file():
            raise SystemExit(f"env file not found: {path}")
        pairs = (line.strip().partition("=") for line in path.read_text(encoding="utf-8").splitlines())
        value = next((v.strip().strip("\"'") for k, _, v in pairs if k.strip() == DATA_ROOT_KEY), "")
    if not value or not Path(value).is_absolute():
        raise SystemExit(f"{DATA_ROOT_KEY} must be set to an absolute path in workflow/local.env or the environment, got: {value!r}")
    return Path(value)
