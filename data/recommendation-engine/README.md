# Recommendation engine data

Working folder for the data behind the garment model of the recommendation engine (BRD section 7.5, FDD section 14.3, LLD section 7.7).

| Item | Status |
| --- | --- |
| `mnist/fashion-mnist_train.csv`, `mnist/fashion-mnist_test.csv` | Fashion-MNIST in CSV form. Never committed: size (about 155 MB) and licence housekeeping (see `.gitignore`) |

## Fashion-MNIST

| Field | Value |
| --- | --- |
| What it is | 70,000 greyscale pictures, 28 by 28 pixels, of single garments in ten types: 0 T-shirt/top, 1 Trouser, 2 Pullover, 3 Dress, 4 Coat, 5 Sandal, 6 Shirt, 7 Sneaker, 8 Bag, 9 Ankle boot |
| Source | Zalando Research (Xiao, Rasul and Vollgraf, "Fashion-MNIST: a Novel Image Dataset for Benchmarking Machine Learning Algorithms", 2017). The file names match the CSV copy published on Kaggle |
| Licence | MIT (copyright Zalando SE). Keep the notice with any copy and cite the paper in the model card |
| Obtained | 2026-10-29, copied from the team's local download (file dates 2019-09-21) |
| Contains personal data | No: pictures of products only |

### Files and checksums

| File | Rows | SHA-256 |
| --- | --- | --- |
| `mnist/fashion-mnist_train.csv` | 60,000 (6,000 per type) | `6e94982a04469e61eb7dc493ce1f606f8ded0a0b8bae7cb4809bf8701fd94b7f` |
| `mnist/fashion-mnist_test.csv` | 10,000 (1,000 per type) | `85ef50a3b4a5b5feead1e7aedae5aade5a2ed5ff59ac79d6525d6282a1a2bc01` |

Each file has a header row, then one row per picture: `label`, then `pixel1` to `pixel784` (values 0 to 255, row by row). The header and counts above were checked on 2026-10-29. If a checksum does not match, do not train on the file.

## What this data can and cannot do

It can teach a model to recognise what kind of garment a picture shows. It holds no information about colour, which clothes go together, or who wears them, so it cannot teach outfit compatibility. How well clothes go together comes from the style rules and ranking weights (FDD sections 14.1 and 14.2) until there is real data and participants have agreed to its use (BRD OI-4).

## Rules for this folder

- Only public data and photos of garments owned by team members are used to build the engine (BR-52). No participant data goes in this folder.
- Record each file's SHA-256 and the date obtained here and in the model card.
- Team photos used for evaluation stay outside the repository and are deleted after the evaluation (LLD 13.4).
