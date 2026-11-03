# D2: data audit

| File | What it is |
| --- | --- |
| `ANCP_TM_D2_v1.pdf` | Audit report (6 pages), datasheet (Appendix A), data dictionary (Appendix B), AI-tool disclosure (Appendix C) |
| `clean_hm.py` | Rebuilds the cleaned dataset from the raw H&M files |
| `data_dictionary.csv` | Every column of the three cleaned files |
| `source/` | HTML source and figures of the report, to edit and re-render (see below) |

## Rerun

The raw H&M files and the cleaned row-level files are not in this repository (size, and the competition rules allow non-commercial research and education only).

```
python clean_hm.py --raw-dir <folder with articles.csv, customers.csv, transactions_train_sample10pct.csv> --out-dir <output folder>
```

The script writes `lines_clean.csv.gz`, `customers_clean.csv.gz`, `articles_clean.csv.gz` and `MANIFEST.json` (SHA-256 of every input and output, row counts, the cleaning funnel, library versions). Output is sorted and has no timestamps, so the same input gives the same checksums. Needs Python 3 with pandas and NumPy.

The script has been run on the real H&M files (3 November 2026), on a 10% customer sample drawn for the test with a fixed seed: it ran without error, two runs gave identical checksums, and the funnel had the shape of Table 4 in the report. That test sample is a different draw from the team's working sample (`transactions_train_sample10pct.csv`), so its checksums are not those of `data-v1.0`. `data-v1.0` is the run on the working sample file; record its `MANIFEST.json` in the team repository and tag the release when that run is made. To run on the full 31.8 million-row file instead, pass `--transactions transactions_train.csv` (the report's numbers are for the 10% sample).

## Re-render the report

`source/d2.html` is the source of `ANCP_TM_D2_v1.pdf`. Render it with Chrome (the page numbers are in the print stylesheet):

```
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --no-pdf-header-footer --print-to-pdf=ANCP_TM_D2_v1.pdf source/d2.html
```

The two figures in `source/figs/` are the notebook's Figure 1 and Figure 2 (cells 18 and 19 of the D3 notebook).
