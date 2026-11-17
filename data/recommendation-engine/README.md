# Recommendation engine data

Working folder for the data behind the recommendation engine's models (BRD section 7.5, FDD section 14, LLD sections 7.7 to 7.9). Nothing in this folder is committed (see `.gitignore`).

| Path | What it is | Status |
| --- | --- | --- |
| `mnist/` | Fashion-MNIST: the original IDX files and the CSV copies | Copied from the team's download. Never committed |
| `hm` | A link to the team's H&M folder (articles, customers, transactions and `images/`) | Link only. Never committed. The target is 32 GB and stays where it is |

## How the data is used

| Source | Used for | Shipped into the product |
| --- | --- | --- |
| Fashion-MNIST IDX files | Garment model version 1 (ten broad types, 28 by 28 greyscale) | `garment-cnn-v1.onnx` |
| H&M photographs and `articles.csv` | Garment model version 2 (twenty types, 96 by 96 colour) and the look embedding | `garment-cnn-v2.onnx`, not committed; kept in a private location and fetched at build by a pinned hash (LLD 12.1). Stays on the worker. In the pilot only after BRD OI-5 is closed |
| H&M `transactions_train.csv`, `customers.csv`, `articles.csv` | The pairing prior and the Wardrobe unlock list | Two small JSON files with no row, article or customer in them: `pairing-prior-v1.json` and the optional H&M unlock list `unlock-candidates.json`. Not committed; kept in a private location and fetched at build by a pinned hash. The web app loads them, so any user of the app can download them: "kept out of the open-source release" is not the same as secret. In the pilot only after BRD OI-5 is closed |
| Style specialist (no H&M data) | The fallback Wardrobe unlock list | `unlock-fallback.json`, written by hand and committed. It is what Wardrobe unlock uses by default |

## Fashion-MNIST

| Field | Value |
| --- | --- |
| What it is | 70,000 greyscale pictures, 28 by 28 pixels, of single garments in ten types: 0 T-shirt/top, 1 Trouser, 2 Pullover, 3 Dress, 4 Coat, 5 Sandal, 6 Shirt, 7 Sneaker, 8 Bag, 9 Ankle boot |
| Source | Zalando Research (Xiao, Rasul and Vollgraf, "Fashion-MNIST: a Novel Image Dataset for Benchmarking Machine Learning Algorithms", 2017) |
| Licence | MIT (copyright Zalando SE). Keep the notice with any copy and cite the paper in the model card |
| Obtained | CSV files 2026-10-29; IDX files 2026-11-03 (file dates 2019-09-21 for the pictures; the label files carry 2026-11-03) |
| Contains personal data | No: pictures of products only |

### Files and checksums

| File | Items | SHA-256 |
| --- | --- | --- |
| `mnist/train-images-idx3-ubyte` | 60,000 pictures | `c59f468a2f672dc815687fe0f83887768d799fd8a3f3276145d20f83aa44d888` |
| `mnist/train-labels-idx1-ubyte` | 60,000 labels (6,000 per type) | `bad3541b69d912435c50bb6ba87bec294ff4f6a2e1246121d8633921760443d9` |
| `mnist/t10k-images-idx3-ubyte` | 10,000 pictures | `5b4141f0afbad91edebe8549f8fcffe087ea10ca49f1dbef5c9a5cd8815ce37b` |
| `mnist/t10k-labels-idx1-ubyte` | 10,000 labels (1,000 per type) | `0402a96d92fd2663957122ceb108a494c5af83dab82d92729df917d7dec38c34` |
| `mnist/fashion-mnist_train.csv` | 60,000 rows | `6e94982a04469e61eb7dc493ce1f606f8ded0a0b8bae7cb4809bf8701fd94b7f` |
| `mnist/fashion-mnist_test.csv` | 10,000 rows | `85ef50a3b4a5b5feead1e7aedae5aade5a2ed5ff59ac79d6525d6282a1a2bc01` |

The IDX headers were checked on 2026-11-03 (picture files: 28 by 28, counts as above). If a checksum does not match, do not train on the file.

**The IDX files and the CSV files are largely the same pictures, split differently.** A check on 2026-11-03 found that 64,397 of the 70,000 CSV pictures are in the IDX files. The splits do not line up: 47,302 of the 60,000 CSV training pictures are in the IDX training file and 7,885 are in the IDX test file; 1,291 of the 10,000 CSV test pictures are in the IDX test file and 7,919 are in the IDX training file; and 10 CSV pictures sit in both the CSV training and test files (where a picture matched, its label agreed in all but one case). Training and testing therefore use the IDX files only. A model trained on the IDX files must never be evaluated on the CSV test set, because about 79% of that set would be pictures it was trained on, and the reverse mix is equally forbidden. The CSV files are kept for notebooks only.

## H&M Personalized Fashion Recommendations

| Field | Value |
| --- | --- |
| What it is | Kaggle competition files from H&M: 105,542 catalogue articles (`articles.csv`), 1,371,980 customers (`customers.csv`), 31.8 million purchase lines (`transactions_train.csv`) and 105,100 product photographs in `images/` (86 folders named by the first three digits of the article ID) |
| Licence | Competition rules: non-commercial research and education. The photographs are H&M's. **Models trained on it may only go into the pilot after BRD OI-5 is closed** |
| Obtained | Files dated 2022-01-17 (the Kaggle release); photographs added to the team's folder 2026-11-03 |
| Contains personal data | Customer IDs are hashed by the publisher and age is given; the team does not try to identify anyone (D2 report) |

### Files and checksums

| File | Size | SHA-256 |
| --- | --- | --- |
| `hm/articles.csv` | 36 MB | `25f21882053517f7684ea43f524225a9481a7bb9aab9cf0abfc7fe8c4576a72b` |
| `hm/customers.csv` | 207 MB | `abf3450c37ee1c16124e0d3379371153f5371148742efdcfe44c97c0445df6b2` |
| `hm/transactions_train.csv` | 3.5 GB | `fff5e3b35c1b26016aa0bf2231be9525bc766eed32c94f1653420b465aef84fa` |

### The photographs (checked 2026-11-03)

- 105,100 JPEG files, 29 GB, about 1166 by 1750 pixels, three colour channels, no transparency.
- Every photograph belongs to an article in `articles.csv`; 442 articles have no photograph (mostly Accessories 153, Shoes 127, Upper body garments 61).
- Menswear: 12,553 articles, 12,504 with a photograph. Main types, counted as articles with a photograph: Trousers 1,751, Sweater 1,650, T-shirt 1,502, Shirt 1,450, Shorts 708, Hoodie 575, Jacket 526, Underwear bottom 383, Socks 361, Polo shirt 318, Blazer 283, Sneakers 272. Underwear bottom and Socks are not among the twenty types of garment model version 2.
- Garment model version 2 tops up thin types from the Divided and Sport departments, which are mostly womenswear (Divided alone has 2,460 dresses, 876 skirts and 874 ladies' denim articles), so part of the training set shows women's garments. The model card says how many pictures come from each source.
- Colour names in `articles.csv` (`perceived_colour_master_name`, with `perceived_colour_value_name` such as Dark) map to Sparta colour families through `colour_map.json` (LLD 4.3 and 7.8), confirmed by the style specialist (FOI-11).
- The photographs are not checksummed one by one. The model card records the checksum of `articles.csv` and the list of article product codes used, as a hash.

## What this data can and cannot do

Fashion-MNIST can teach a model what broad kind of garment a picture shows. The H&M photographs teach finer types in full colour and a look embedding. The H&M purchase lines show which types and colours one customer bought on the same day. None of it says which outfits Indian men find stylish or wear together: how well clothes go together still comes from the style rules and ranking weights (FDD sections 14.1 and 14.2). The pairing prior is a small, reviewed nudge. There is no participant data in any of it, and participants' data is not used to train anything (BRD BR-28, BR-52, OI-4).

## Rules for this folder

- Only public data and photos of garments owned by team members are used to build the engine (BR-52). No participant data goes in this folder.
- H&M photographs, purchase lines, customer IDs and article IDs are never copied out of this folder, committed, uploaded to Supabase or any service, shown to users or vendors, or built into the worker image (BR-59). Raw H&M files are deleted when the course ends.
- Record each file's SHA-256 and the date obtained here and in the model card.
- Team photos used for evaluation stay outside the repository and are deleted after the evaluation (LLD 13.4).

The folder `artifacts/` (path in `SPARTA_ARTIFACT_DIR`, git-ignored) holds the files the offline scripts write: `pairing-prior-v1.json` and `unlock-candidates.json` (from `ml/recommendation-engine/pairing/build_prior.py`, with its card `PRIOR_CARD.md` committed) and, later, `garment-cnn-v2.onnx`. Never committed; no H&M row, article ID or customer ID is written there by the pairing build.
