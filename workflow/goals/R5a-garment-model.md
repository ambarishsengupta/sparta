# Goal: the committed garment model v1 matches its card and reproduces its accuracy
Predicate: `npx vitest run workflow/gates/model_card.test.ts >/dev/null 2>&1 && $(grep SPARTA_VENV_PYTHON workflow/local.env | cut -d= -f2) -B -m unittest discover -s ml/recommendation-engine/garment/tests >/dev/null 2>&1`
Completed: 2026-11-04
Triggered by: release R5a (garment CNN v1, Fashion-MNIST, test accuracy 0.8953)
Status: holding
Last pass: 2026-11-12
On violation: check the ONNX SHA-256 against the card; re-run evaluate.py; never switch GARMENT_GUESS_ENABLED on before the 100-photo team evaluation (LOI-9).
Retire when: garment model v2 or a retrained v1 replaces it and a new goal is written.
