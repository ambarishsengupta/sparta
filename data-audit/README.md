# Data audit (ANCP D2)

Working folder for the data audit of the public H&M dataset.

| Item | Status |
| --- | --- |
| `data_flow_diagram.png`, `.pdf`, `.svg` | Planned data flow for the audit (no counts or results) |
| `raw/` | Raw files. Never committed: size and the Kaggle rules (see `.gitignore`) |
| `scripts/extract_audit_stats.py` | Run once where the raw files are. Writes small summary tables (`audit_stats/`) for the audit report and the EDA notebook. Tested on synthetic files with the same columns |
| `audit_stats/` | Output of the script. Not committed (derived from the H&M data) |

Source: H&M Personalized Fashion Recommendations (Kaggle). The competition rules limit use to non-commercial research and education. Record the date each file was accessed and its SHA-256 checksum in the audit report.

## Running the extraction script in a notebook

If the three DataFrames are already loaded as `articles`, `customers` and `transactions`, save `extract_audit_stats.py` next to the notebook and run:

```python
import extract_audit_stats as eas
eas.run(articles, customers, transactions, out_dir="audit_stats", max_rows=500000)   # quick test first
eas.run(articles, customers, transactions, out_dir="audit_stats")                    # full run
```

Leading zeros lost on loading (`article_id`, `product_code`, `colour_group_code`) are restored, so the files do not need to be re-read as text. Because the raw files are not read in this mode, add the SHA-256 checksum of each original file to the audit report by hand.

## Running the extraction script from the command line

```
pip install pandas numpy
python data-audit/scripts/extract_audit_stats.py --max-rows 500000   # quick test first
python data-audit/scripts/extract_audit_stats.py                     # full run
```

Put `articles.csv`, `customers.csv` and `transactions_train.csv` in `data-audit/raw/` (or pass `--raw-dir`). The full run needs about 4 GB of free memory and takes 10 to 30 minutes. It writes `data-audit/audit_stats/audit_stats.zip`: share that zip. Add `--write-menswear-extract` for a row-level menswear transactions file, and `--menswear-groups "Menswear,Divided"` if the audit decides to count more index groups as menswear.
