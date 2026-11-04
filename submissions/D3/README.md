# D3: exploratory data analysis

| File | What it is |
| --- | --- |
| `ANCP_TM_D3_eda.ipynb` | The EDA notebook with its stored outputs |
| `ANCP_TM_D3_eda.html` | HTML export of the notebook |
| `ANCP_TM_D3_summary.pdf` | Cover page and two-page insight summary |
| `figures/` | The 12 figures in the notebook |
| `outputs/insight_log.csv`, `outputs/key_numbers.json` | Every insight with its evidence, and every quoted number |
| `reference/full_population_profile.json` | Profile of the full transaction file, used by the representativeness checks |
| `validation/` | Independent re-derivation of the headline figures (25 of 25 reproduced) and its report |
| `build_*.py`, `nb_cells_*.py`, `nb_helpers.py`, `run_nb.py` | Scripts that build and run the notebook and the summary PDF |

Version 2 (3 November 2026) aligns the wording with the Sparta documents (BRD, FDD, charter): audience, decisions and metrics. The analysis, code and numbers are unchanged from the run that produced the stored outputs.

To rerun the notebook, put the H&M files (`articles.csv`, `customers.csv`, `transactions_train_sample10pct.csv`) in a `data` folder next to it or set `HM_DATA_DIR`. To rerun the validation:

```
python -I validation/validate_eda.py <D2 data-v1.0 folder> outputs validation/validation_results.json
```
