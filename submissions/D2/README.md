# D2: data audit

| File | What it is |
| --- | --- |
| `ANCP_TM_D2_v1.pdf` | Audit report (6 pages), datasheet (Appendix A), data dictionary (Appendix B), AI-tool disclosure (Appendix C) |
| `clean_data.py` | Rebuilds the cleaned dataset (`data-v1.0`) from the raw H&M files |
| `data-v1.0/data_dictionary.csv` | Every column of the three cleaned files |
| `data-v1.0/SHA256SUMS.txt` | SHA-256 of the three cleaned tables and the dictionary |
| `audit_metrics.json` | Every number in the audit, including the SHA-256 of each raw input (`inputs_sha256`) |
| `verify_sample.py`, `sample_integrity.json` | Check that the 10% sample holds every row of each sampled customer in the full file |
| `make_figures.py`, `make_report.py`, `figures/` | Figure and report builders |

## Rerun

The raw H&M files and the cleaned row-level files are not in this repository (size, and the competition rules allow non-commercial research and education only, with no redistribution). The cleaned tables are shared privately with the course team and assessor.

```
python -I clean_data.py <folder with articles.csv, customers.csv, transactions_train_sample10pct.csv> .
cd data-v1.0 && sha256sum -c SHA256SUMS.txt
```

The script writes `data-v1.0/` (`transactions_clean.csv.gz`, `customers_clean.csv.gz`, `articles_clean.csv.gz`, `data_dictionary.csv`, `SHA256SUMS.txt`) and `audit_metrics.json`. It has been run on the real files, and a second run gives identical checksums. Needs Python 3.13, pandas 2.2 and NumPy 2.1; the builders also need matplotlib and reportlab.
