# D2: data audit

| File | What it is |
| --- | --- |
| `ANCP_TM_D2_v1.pdf` | Audit report (6 pages), datasheet (Appendix A), data dictionary (Appendix B), AI-tool disclosure (Appendix C) |
| `clean_hm.py` | Rebuilds the cleaned dataset from the raw H&M files |
| `data_dictionary.csv` | Every column of the three cleaned files |

## Rerun

The raw H&M files and the cleaned row-level files are not in this repository (size, and the competition rules allow non-commercial research and education only).

```
python clean_hm.py --raw-dir <folder with articles.csv, customers.csv, transactions_train_sample10pct.csv> --out-dir <output folder>
```

The script writes `lines_clean.csv.gz`, `customers_clean.csv.gz`, `articles_clean.csv.gz` and `MANIFEST.json` (SHA-256 of every input and output, row counts, the cleaning funnel, library versions). Output is sorted and has no timestamps, so the same input gives the same checksums. Needs Python 3 with pandas and NumPy.

The script has been tested on a synthetic file with the real column layout (two runs, identical checksums). It has not yet been run on the real files.
