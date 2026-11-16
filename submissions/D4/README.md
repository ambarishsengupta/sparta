# D4: modelling checkpoint

| File | What it is |
| --- | --- |
| `ANCP_TM_D4_v1.pdf` | Cover page and three-page report: problem type and model choice, baselines, candidate models, validation design, results, intervals, reproducibility |
| `validation_design.json` | Train, validation and test split, metric, tuning budget and leakage guards, fixed before the first run. Its SHA-256 prefix is on every log row |
| `experiment_log.csv` | One row per run: date, stage, origins, model, data version, features, parameters, random seed, WAPE (Menswear and all), bias, run time, design and code hash |
| `d4_lib.py` | Weekly segment panel, features at a forecast origin, baselines, metrics |
| `run_experiments.py` | Every run on the validation origins; writes the log and `outputs/` |
| `validate_metrics.py` | Independent re-check (does not import `d4_lib`) and bootstrap over segments: `outputs/metric_check.json` |
| `build_report.py` | Figures and the PDF; every number is read from the log and `outputs/` |
| `outputs/` | Selected settings for D5, interval check, WAPE by origin and horizon, feature importance, validation predictions |
| `environment.yml`, `requirements.txt` | Pinned environment |

## Problem and models

Weekly demand forecast per segment (product type x master colour within a department), 1 to 4 weeks ahead, on the H&M stand-in data.
This is the charter's forecasting metric (D1 Table 3): WAPE against a same-period-last-year forecast, target 15% or more lower, with an 80% interval covering 75% to 85%.
Menswear segments are the primary score.

| Model | Type | Validation WAPE, Menswear |
| --- | --- | --- |
| B0 same week last year | Charter baseline (seasonal naive) | 0.587 |
| B1 mean of last 4 weeks | Naive rule | 0.500 |
| M1 scaled seasonal naive | Rule with 3 tuned settings (18-run grid) | 0.462 |
| M2 Poisson GLM | Linear, log link (4-run grid) | 0.496 |
| M3 LightGBM, Tweedie loss, one model for all segments | Gradient boosting (12-trial random search, 3 seed reruns) | 0.455 |

M3 is 22.5% below B0 (bootstrap 95% CI 17.3% to 27.7%), which meets the charter target. It is level with M1 (no detectable difference), so D5 scores both. Source: `outputs/selected_configs.json`, `outputs/metric_check.json`.

Validation uses 9 rolling origins (targets 2019-11-20 to 2020-07-21). The test origins (targets 2020-07-22 to 2020-09-22) are declared but **not run** in D4: charter risk R4 keeps the final holdout untouched until D5.

## Rerun

The cleaned data `data-v1.0` is not in this repository (size, and the competition rules allow non-commercial research and education only). Put it at `../D2/data-v1.0` or pass `--data`. The loader checks `transactions_clean.csv.gz` against `SHA256SUMS.txt` and stops on a mismatch.

```
conda env create -f environment.yml
conda activate ancp-d4
python -I run_experiments.py      # about 2 minutes on a 16-thread laptop
python -I validate_metrics.py
python -I build_report.py
```

Seeds are fixed (random search 42; model 42, plus 1 to 3 for the variance check). The rules and the GLM are deterministic.
