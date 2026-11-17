# Model card: garment-cnn-v1

**Status: the 100-photo team evaluation of LLD 7.7 is NOT done.** The confidence threshold is therefore only the documented default 0.6, not a measured value, and `GARMENT_GUESS_ENABLED` must stay false for any pilot until that evaluation is done (LOI-9). The accuracy below is on Fashion-MNIST studio pictures, not on phone photos.

**ONNX SHA-256:** `fcd2da1fdfc6701fc8ecf70e500ccc1db7581b3413a7033ec73a47685c2083fc`

| Field | Value |
| --- | --- |
| Model version | garment-cnn-v1 (file `services/worker/models/garment-cnn-v1.onnx`, 105,626 bytes, opset 17) |
| Task | Ten broad garment types from a 28 by 28 greyscale picture, plus 32 shape numbers (`scores` then `shape` outputs) |
| Network | Three 3x3 conv blocks (16, 32, 64 channels, ReLU, 2x2 max pooling after the first two), global average pooling, dense 32 with ReLU, dense 10; 25,706 weights |
| Preprocessing | `preprocess.py` (LLD 7.7 steps 1 to 6), the same code for evaluation and the worker |

## Data and split

Fashion-MNIST IDX files only (the CSV copies are never read). SHA-256 of each file, equal to `data/recommendation-engine/README.md`:

| File | SHA-256 |
| --- | --- |
| `train-images-idx3-ubyte` | `c59f468a2f672dc815687fe0f83887768d799fd8a3f3276145d20f83aa44d888` |
| `train-labels-idx1-ubyte` | `bad3541b69d912435c50bb6ba87bec294ff4f6a2e1246121d8633921760443d9` |
| `t10k-images-idx3-ubyte` | `5b4141f0afbad91edebe8549f8fcffe087ea10ca49f1dbef5c9a5cd8815ce37b` |
| `t10k-labels-idx1-ubyte` | `0402a96d92fd2663957122ceb108a494c5af83dab82d92729df917d7dec38c34` |

Split of the 60,000 IDX training pictures: 54,000 training and 6,000 validation, stratified by label, seed 20261104. The 10,000 IDX test pictures were used only for this report and for the 100-picture export check.

## Training settings

Optimiser Adam, learning rate 0.003 (cosine to 1% over 30 epochs), batch size 128, cross-entropy with label smoothing 0.1, up to 30 epochs, early stopping on validation accuracy with patience 6 (best weights kept), time-box 25 minutes. Augmentation: rotation +-8 deg, shift +-1.5 px, scale 0.92-1.08 (p=0.5); brightness +-0.15 and contrast 0.75-1.25 (p=0.3); 3x3 Gaussian blur (p=0.1); random erasing of one 3-9 px box (p=0.1). Augmentation strength and learning rate were chosen by comparing full runs on the validation split only (`workflow/evidence/R5/tuning-notes.txt`); the test pictures played no part.

Result of the run: 30 epochs run, best epoch 30, validation accuracy 0.8983, stopped by max_epochs, 341 seconds on 8 CPU threads.

Libraries: Python 3.13.0, torch 2.15.0, numpy 2.5.4, onnx 1.23.2, onnxruntime 1.31.1, pillow 13.0.0. Licences: PyTorch BSD-3, NumPy BSD-3, ONNX Apache-2.0, ONNX Runtime MIT, Pillow HPND.

## Export check

onnxruntime against PyTorch on 100 test pictures, both outputs: largest absolute difference 1.05e-05 (tolerance 0.0001).

## Test results (10,000 IDX test pictures, run with onnxruntime)

**Overall accuracy: 0.8953** (8,953 of 10,000).

| Class | Name | Correct | Accuracy |
| --- | --- | --- | --- |
| 0 | T-shirt/top | 835 / 1000 | 0.8350 |
| 1 | Trouser | 969 / 1000 | 0.9690 |
| 2 | Pullover | 852 / 1000 | 0.8520 |
| 3 | Dress | 895 / 1000 | 0.8950 |
| 4 | Coat | 832 / 1000 | 0.8320 |
| 5 | Sandal | 966 / 1000 | 0.9660 |
| 6 | Shirt | 700 / 1000 | 0.7000 |
| 7 | Sneaker | 966 / 1000 | 0.9660 |
| 8 | Bag | 977 / 1000 | 0.9770 |
| 9 | Ankle boot | 961 / 1000 | 0.9610 |

Confusion matrix (rows are the true class, columns the predicted class):

| true \ predicted | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
|---|---|---|---|---|---|---|---|---|---|---|
| **0 T-shirt/top** | 835 | 0 | 13 | 28 | 6 | 1 | 103 | 0 | 14 | 0 |
| **1 Trouser** | 0 | 969 | 1 | 24 | 4 | 0 | 2 | 0 | 0 | 0 |
| **2 Pullover** | 12 | 0 | 852 | 12 | 64 | 0 | 59 | 0 | 1 | 0 |
| **3 Dress** | 15 | 4 | 9 | 895 | 22 | 0 | 52 | 0 | 3 | 0 |
| **4 Coat** | 1 | 1 | 51 | 42 | 832 | 0 | 70 | 0 | 3 | 0 |
| **5 Sandal** | 0 | 0 | 0 | 0 | 0 | 966 | 0 | 26 | 0 | 8 |
| **6 Shirt** | 124 | 0 | 56 | 31 | 82 | 0 | 700 | 0 | 7 | 0 |
| **7 Sneaker** | 0 | 0 | 0 | 0 | 0 | 8 | 0 | 966 | 0 | 26 |
| **8 Bag** | 2 | 0 | 3 | 3 | 4 | 3 | 4 | 3 | 977 | 1 |
| **9 Ankle boot** | 0 | 0 | 1 | 0 | 0 | 3 | 0 | 35 | 0 | 961 |

## Known limits

- Trained on greyscale studio pictures of single garments; phone photos (backgrounds, shadows, folds, hangers, hands) differ and accuracy there is not measured.
- White and very light garments come out dark and faint after inversion (as in the original data).
- Most frequent mistakes in this test run (true class as predicted class, count): Shirt as T-shirt/top 124; T-shirt/top as Shirt 103; Shirt as Coat 82.
- Ten broad types only: Dress has no mapping, and sub-types such as Jeans, Shorts, Kurta or Blazer cannot be named.
- Not trained or tested on any H&M data, team photo or participant data.

## Citation and licence

Xiao, H., Rasul, K. and Vollgraf, R. (2017). Fashion-MNIST: a Novel Image Dataset for Benchmarking Machine Learning Algorithms. arXiv:1708.07747.

The MIT License (MIT). Copyright (c) 2017 Zalando SE, https://tech.zalando.com. Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
