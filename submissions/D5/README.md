# D5: model validation memo (garment-cnn-v1)

| File | What it is |
| --- | --- |
| `ANCP_TM_D5_v1.pdf` | The 4-page memo for the decision-maker |
| `ANCP_TM_D5_eval.ipynb` | Evaluation notebook with stored outputs (text and PNG only) |
| `d5_seed_runs.py` | Retrains the model with one seed and scores the test file once; writes `evidence/seed_<seed>.json` |
| `evidence/` | `seed_*.json` (five retrainings: test predictions and top scores, no pictures) and `d5_results.json` (every number in the memo) |
| `figs/` | The two figures in the memo |
| `source/` | `build_memo.py` (writes `d5.html` from `d5_results.json`) and `d5.html`, the source of the PDF |

Tag `d5-v1` marks this version.

## Rerun

The Fashion-MNIST files are not committed. Set `SPARTA_DATA_ROOT_MNIST` (or `workflow/local.env`) to the folder with the four IDX files and the two CSV files, and use the pinned `ml/recommendation-engine/requirements.txt` plus `scikit-learn`, `matplotlib`, `scipy`, `nbclient` and `ipykernel`.

```
cd submissions/D5
for s in 20261104 1 2 3 4; do python d5_seed_runs.py --seed $s --threads 2; done   # about 7 minutes each; seed 20261104 repeats the released run
jupyter nbconvert --to notebook --execute --inplace ANCP_TM_D5_eval.ipynb         # about 1 minute
python source/build_memo.py
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --no-pdf-header-footer --print-to-pdf=ANCP_TM_D5_v1.pdf source/d5.html
```

The notebook changes no model, threshold or setting. It reads the CSV test file in one cell only, to show what the overlap with the IDX training file would do.
