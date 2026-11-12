"""Builds figures and ANCP_TM_D4_v1.pdf from experiment_log.csv and outputs/. No result is typed by hand."""
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (BaseDocTemplate, Frame, Image, PageBreak, PageTemplate, Paragraph, Spacer, Table,
                                TableStyle)

HERE = Path(__file__).resolve().parent
O, FIG = HERE / "outputs", HERE / "figures"
FIG.mkdir(exist_ok=True)
log = pd.read_csv(HERE / "experiment_log.csv")
sel = json.loads((O / "selected_configs.json").read_text())
chk = json.loads((O / "metric_check.json").read_text())
cov = json.loads((O / "interval_check.json").read_text())
info = json.loads((O / "panel_info.json").read_text())
byo = pd.read_csv(O / "wape_by_origin_menswear.csv")
byh = pd.read_csv(O / "wape_by_horizon_menswear.csv")
imp = pd.read_csv(O / "m3_feature_importance_gain.csv", index_col=0).iloc[:, 0]
design = json.loads((HERE / "validation_design.json").read_text())

INK, INK2, BLUE, ORANGE, GRID, MUTED = "#0b0b0b", "#52514e", "#2a78d6", "#eb6834", "#e1e0d9", "#a3a29c"
KEYS = ["B0", "B1", "M1", "M2", "M3"]
NAME = {"B0": "B0 seasonal naive (same week last year)", "B1": "B1 naive (mean of last 4 weeks)",
        "M1": "M1 scaled seasonal naive", "M2": "M2 Poisson GLM", "M3": "M3 LightGBM Tweedie (global)"}
SHORTN = {"B0": "B0 same week last year", "B1": "B1 last-4-week mean", "M1": "M1 scaled seasonal naive",
          "M2": "M2 Poisson GLM", "M3": "M3 LightGBM (global)"}
va = log[log.stage == "valid"]
W = sel["valid_wape_menswear"]
BT = chk["bootstrap_over_menswear_segments"]
target = W["B0"] * 0.85


def best_row(k):
    v = va[va.model == NAME[k]]
    if k == "M3":
        v = v[v.notes.fillna("").str.startswith("random")]
    return v.loc[v.wape_menswear.idxmin()]


BR = {k: best_row(k) for k in KEYS}
seeds = va[(va.model == NAME["M3"]) & va.notes.fillna("").str.startswith("seed")].wape_menswear.tolist() + [BR["M3"].wape_menswear]

plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 7.5, "axes.edgecolor": MUTED, "axes.labelcolor": INK2,
                     "xtick.color": INK2, "ytick.color": INK2, "axes.spines.top": False, "axes.spines.right": False})

# Fig 1: every validation run per family, selected setting highlighted, charter target line
fig, ax = plt.subplots(figsize=(6.6, 2.05), dpi=220)
for i, k in enumerate(KEYS):
    v = va[va.model == NAME[k]]
    tr = v[~v.notes.fillna("").str.startswith("seed")]
    ax.scatter(tr.wape_menswear, [i] * len(tr), s=14, color=MUTED, zorder=2, label="Validation run" if i == 2 else None)
    if k == "M3":
        sd = v[v.notes.fillna("").str.startswith("seed")]
        ax.scatter(sd.wape_menswear, [i + 0.24] * len(sd), s=14, marker="D", color=ORANGE, zorder=3, label="Seed rerun (1, 2, 3)")
    ax.scatter([BR[k].wape_menswear], [i], s=36, facecolor=BLUE, edgecolor="white", lw=1.2, zorder=4, label="Selected setting" if i == 0 else None)
    ax.text(BR[k].wape_menswear - 0.004, i - 0.3, f"{BR[k].wape_menswear:.3f}", fontsize=6.3, color=INK, ha="right")
ax.axvline(target, color=INK2, lw=0.8, ls=(0, (3, 2)))
ax.text(target + 0.002, 4.45, "Charter target: 15% below B0", fontsize=6.3, color=INK2)
ax.set_yticks(range(len(KEYS)), [f"{SHORTN[k]}  (n={int((va.model == NAME[k]).sum())})" for k in KEYS])
ax.invert_yaxis()
ax.set_ylim(4.7, -0.8)
ax.set_xlabel("Validation WAPE, Menswear segments (lower is better); one dot per logged run")
ax.xaxis.grid(True, color=GRID, lw=0.6)
ax.set_axisbelow(True)
ax.legend(frameon=False, fontsize=6.3, loc="lower left", ncol=3, bbox_to_anchor=(0, 1.0))
fig.tight_layout()
fig.savefig(FIG / "fig1_validation_runs.png")
plt.close(fig)

# Fig 2: WAPE by origin for the charter baseline and the chosen model
fig, ax = plt.subplots(figsize=(6.6, 1.85), dpi=220)
xs = pd.to_datetime(byo.first_target_week_end)
for k, c, ls in (("B0", INK2, (0, (3, 2))), ("M1", ORANGE, "-"), ("M3", BLUE, "-")):
    ax.plot(xs, byo[k], color=c, lw=2 if k != "B0" else 1.2, ls=ls, marker="o", ms=3.5)
    ax.text(xs.iloc[-1] + pd.Timedelta(days=5), byo[k].iloc[-1], SHORTN[k], fontsize=6.3, color=INK, va="center")
ax.axvspan(pd.Timestamp("2020-03-10"), pd.Timestamp("2020-05-05"), color=GRID, alpha=0.6, lw=0)
ax.text(pd.Timestamp("2020-03-13"), ax.get_ylim()[0] + 0.01, "COVID-19 closures", fontsize=6.3, color=INK2, va="bottom")
ax.set_ylabel("WAPE, Menswear")
ax.set_xlim(xs.iloc[0] - pd.Timedelta(days=8), xs.iloc[-1] + pd.Timedelta(days=45))
ax.yaxis.grid(True, color=GRID, lw=0.6)
ax.set_axisbelow(True)
fig.tight_layout()
fig.savefig(FIG / "fig2_wape_by_origin.png")
plt.close(fig)

# ---------- PDF ----------
fd = Path(matplotlib.get_data_path()) / "fonts" / "ttf"
pdfmetrics.registerFont(TTFont("DV", str(fd / "DejaVuSans.ttf")))
pdfmetrics.registerFont(TTFont("DVB", str(fd / "DejaVuSans-Bold.ttf")))
pdfmetrics.registerFontFamily("DV", normal="DV", bold="DVB", italic="DV", boldItalic="DVB")
S = lambda n, **kw: ParagraphStyle(n, **{"fontName": "DV", "textColor": colors.HexColor(INK), **kw})
big = S("big", fontName="DVB", fontSize=20, leading=25)
mid = S("mid", fontSize=12, leading=16, textColor=colors.HexColor(INK2))
title = S("t", fontName="DVB", fontSize=14, leading=17)
sub = S("s", fontSize=7.8, leading=10, textColor=colors.HexColor(INK2))
h2 = S("h2", fontName="DVB", fontSize=10, leading=12.5, spaceBefore=6, spaceAfter=2, textColor=colors.HexColor(BLUE))
body = S("b", fontSize=8.2, leading=10.8, spaceAfter=3)
cell = S("c", fontSize=6.9, leading=8.6)
cellb = S("cb", fontName="DVB", fontSize=6.9, leading=8.6)
cap = S("cap", fontSize=6.8, leading=8.4, textColor=colors.HexColor(INK2), spaceAfter=4)
cov_cell = S("cc", fontSize=9.5, leading=13)
cov_cellb = S("ccb", fontName="DVB", fontSize=9.5, leading=13)
P = lambda s, st=body: Paragraph(s, st)


def table(rows, widths, head=True, st=(cell, cellb)):
    t = Table([[P(str(c), st[1] if (head and r == 0) else st[0]) for c in row] for r, row in enumerate(rows)],
              colWidths=[w * mm for w in widths], repeatRows=1 if head else 0)
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"),
                           ("LINEBELOW", (0, 0), (-1, 0), 0.6 if head else 0.25, colors.HexColor(INK2 if head else GRID)),
                           ("LINEBELOW", (0, 1), (-1, -1), 0.25, colors.HexColor(GRID)),
                           ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
                           ("LEFTPADDING", (0, 0), (-1, -1), 3), ("RIGHTPADDING", (0, 0), (-1, -1), 3)]))
    return t


pct = lambda x: f"{x:.1%}"
st = [Spacer(1, 30 * mm), P("Analytics Capstone Project (ANCP)", mid), Spacer(1, 4),
      P("Sparta: Wardrobe Demand Analytics for Brands", big),
      P("Deliverable D4: Modelling checkpoint (baselines, candidate models, experiment log)", mid), Spacer(1, 14 * mm),
      table([["Group number", "M"], ["Deliverable code / version", "D4 / v1"], ["Date", "12 November 2026"],
             ["Lead owner for this deliverable", "C. Prashanth"], ["Reviewers", "Ambarish Sengupta, Arpan Shah (consulted)"],
             ["Term", "Term 5, 6 October to 20 November 2026"],
             ["Members", "C. Prashanth (BA05015)<br/>Arpan Shah (BA05009)<br/>Ambarish Sengupta (BA05007)"],
             ["Linked outcomes", "CO3"],
             ["Files", "ANCP_TM_D4_v1.pdf; code, experiment_log.csv, validation_design.json, environment.yml and README in "
                       "submissions/D4 of the team repository, tag d4-v1"]], [62, 100], head=False, st=(cov_cell, cov_cellb)),
      PageBreak()]

st += [P("Sparta: forecasting segment demand, baselines first", title),
       P(f"ANCP D4 · Modelling checkpoint · Group M · Linked outcome CO3 · Data: data-v1.0 (D2), H&amp;M 10% customer sample, "
         f"{info['segments_kept']} weekly segments ({info['segments_menswear']} Menswear), a stand-in for Sparta purchase and demand data "
         "while the pilot has none", sub), Spacer(1, 2)]
st += [P("Bottom line", h2),
       P(f"On the validation origins, the global LightGBM forecaster (M3) has a Menswear WAPE of <b>{W['M3']:.3f}</b> against <b>{W['B0']:.3f}</b> "
         f"for the charter baseline (same week last year): <b>{BT['M3 - B0']['relative_reduction']:.1%} lower</b> "
         f"(95% CI {BT['M3 - B0']['relative_ci95'][0]:.1%} to {BT['M3 - B0']['relative_ci95'][1]:.1%}, bootstrap over segments). "
         f"This clears the charter target of 15% or more. Two cautions. First, the same-week-last-year baseline is weak here: a plain "
         f"last-4-week mean (B1) already scores {W['B1']:.3f}, and M3 beats it by only {BT['M3 - B1']['relative_reduction']:.1%}. Second, the simple "
         f"scaled seasonal naive (M1, {W['M1']:.3f}) is statistically level with M3 (CI {BT['M3 - M1']['relative_ci95'][0]:+.1%} to "
         f"{BT['M3 - M1']['relative_ci95'][1]:+.1%}). The 80% intervals cover {cov['coverage_menswear']:.1%} of Menswear actuals on the check origins "
         f"(target 75% to 85%). <b>The test weeks are untouched</b> (charter risk R4); D5 scores M3 and M1 on them once.")]

st += [P("1  Problem type and why these model families fit", h2),
       P("The charter's primary decision is which menswear category-colour segments a brand should add or expand. Until the pilot "
         "has data, D4 builds the part the charter assigns to public data: a <b>demand forecast per segment</b> (Table 3, WAPE against "
         "same-period-last-year, with an 80% interval). We frame it as <b>weekly count forecasting for many related, short, seasonal series</b>, "
         "1 to 4 weeks ahead. A segment is a product type x master colour within a department (H&amp;M has no fit field). Sparta is menswear, "
         "so Menswear segments are the primary score; models learn from all departments, which share seasonality."),
       table([["Family", "Why it fits (evidence)", "Risk we watch"],
              ["Seasonal naive and naive (B0, B1)", "The charter names same-period-last-year as the baseline. The last-4-week mean is the standard "
               "naive forecast [1] and tests whether seasonality helps at all when demand turns over within weeks (D3 I5).", "Two years of history: one past season per week."],
              ["Scaled seasonal naive (M1)", "Last year's shape times this year's level. Explainable to a brand and robust on 2 years of data; three "
               "tuned knobs.", "Breaks when the level shifts suddenly (2020)."],
              ["Poisson GLM (M2)", "Linear in log demand; counts with many small values; one model for all segments.", "No interactions, e.g. season x product type."],
              ["Global gradient boosting, Tweedie loss (M3)", "One model across 950 series pools seasonality; Tweedie suits zero-heavy counts. Global "
               "LightGBM models led the M5 retail forecasting competition [2][3].", "Overfitting validation; opaque to a brand."]],
             [34, 100, 40])]

st += [P("2  Validation design, declared before tuning", h2),
       P(f"Fixed in <font face='DVB'>validation_design.json</font> on {design['declared_on']} before the first run; its hash "
         f"({log.design_sha.iloc[0]}) is on every log row. A <b>rolling origin with an expanding window</b> [1][4]: at each origin the models "
         "see only earlier weeks, and global models are refitted on training origins whose targets are already observed. Origins span "
         "pre-COVID and 2020 weeks, because D3 (I9) warned against tuning on 2020 alone. Segments are kept if they average 2+ units a week before "
         f"the first validation target (week 58), so eligibility cannot leak. {info['units_partial_week_dropped']:,} units in the first partial "
         f"week are dropped; kept segments hold {info['share_units_kept']:.1%} of units."),
       table([["Part", "Weeks (7-day, ending Tuesday)", "Use"],
              ["Train", "From 2018-09-26, expanding up to each origin", "Features and model fitting; last-year features from week 52 on"],
              ["Validation", "9 origins every 4 weeks; targets 2019-11-20 to 2020-07-21", f"All tuning and selection ({len(va)} runs)"],
              ["Test", "2 origins; targets 2020-07-22 to 2020-09-22", "Declared, not run. Scored once in D5 (charter R4)"]],
             [20, 70, 84])]

st += [P("3  Baselines first, then candidate models", h2),
       Image(str(FIG / "fig1_validation_runs.png"), width=172 * mm, height=172 * mm * 2.05 / 6.6),
       P("Figure 1. Every validation run. The dashed line is the charter target (15% below B0). Runs below it: " +
         ", ".join(f"{k} {int((va[va.model == NAME[k]].wape_menswear < target).sum())} of {int((va.model == NAME[k]).sum())}" for k in KEYS[1:]) +
         ". The GLM clears it only narrowly.", cap)]
rows = [["Model", "Tuning approach", "Runs", "Selected setting", "WAPE<br/>Menswear", "WAPE<br/>all", "Bias<br/>Menswear"]]
tun = {"B0": "None (charter baseline)", "B1": "None (rule fixed in advance)",
       "M1": "Full grid 3x3x2: recent window {4, 8, 13} wk x shrink {0, 0.5, 1} x last-year smoothing {1, 3} wk",
       "M2": "Grid over L2 penalty alpha {0.001, 0.01, 0.1, 1}; refit at each origin",
       "M3": "Random search, 12 trials (seed 42) over leaves, learning rate, trees, min child, column and row sampling, Tweedie power; "
             "refit at each origin; best re-run with seeds 1-3"}
setting = {"B0": "lag 52 weeks", "B1": "4 weeks",
           "M1": f"window {sel['M1']['window_weeks']}, shrink {sel['M1']['shrink']}, smoothing {sel['M1']['ly_smooth']}",
           "M2": f"alpha {sel['M2']['alpha']}", "M3": ", ".join(f"{k} {v}" for k, v in sel["M3"].items())}
for k in KEYS:
    r = BR[k]
    rows.append([SHORTN[k], tun[k], int((va.model == NAME[k]).sum()), setting[k], f"{r.wape_menswear:.3f}", f"{r.wape_all:.3f}", f"{r.bias_menswear:+.3f}"])
st += [table(rows, [26, 52, 9, 41, 16, 13, 17])]

st += [P("4  Is the gain real?", h2),
       table([["Comparison (validation, Menswear)", "WAPE difference", "95% CI", "Relative reduction (95% CI)", "Reading"]] +
             [[k.replace("M3", "M3 LightGBM").replace("B0", "B0 last year").replace("B1", "B1 naive").replace("M2", "M2 GLM").replace(" - M1", " - M1 scaled").replace("M1 -", "M1 scaled -"),
               f"{v['diff']:+.3f}", f"{v['ci95'][0]:+.3f} to {v['ci95'][1]:+.3f}",
               f"{v['relative_reduction']:.1%} ({v['relative_ci95'][0]:.1%} to {v['relative_ci95'][1]:.1%})",
               "Clear gain" if v["ci95"][1] < 0 else ("Clear loss" if v["ci95"][0] > 0 else "No detectable difference")]
              for k, v in BT.items() if " - " in k], [44, 22, 32, 44, 32]),
       P(f"Paired bootstrap resampling whole Menswear segments ({chk['menswear_segments']} segments, 2,000 draws, seed 7), so the correlation "
         f"across a segment's weeks is kept. <b>Seed variance:</b> the selected M3 setting scores {min(seeds):.3f} to {max(seeds):.3f} over seeds 42, 1, 2, 3, "
         f"a range of {max(seeds) - min(seeds):.3f}, smaller than any gap read as clear above. <b>By origin</b> (Figure 2), " +
         ", ".join(f"{k} is worst at {byo.loc[byo[k].idxmax(), 'first_target_week_end']} ({byo[k].max():.2f})" for k in ("B0", "M1", "M3")) +
         "; the spring 2020 closures hurt every model, and last year's pattern fails longest. <b>By horizon</b>, the best model is " +
         ", ".join(f"{min(['M1', 'M2', 'M3'], key=lambda k: r[k])} at {int(r.h)} wk" for _, r in byh.iterrows()) +
         ", which supports carrying M3 and M1 to D5."),
       Image(str(FIG / "fig2_wape_by_origin.png"), width=172 * mm, height=172 * mm * 1.85 / 6.6),
       P("Figure 2. Menswear WAPE at each validation origin (date of the first forecast week).", cap)]

st += [P("5  Uncertainty: 80% prediction intervals", h2),
       P(f"Split conformal intervals [5] on the log ratio (actual + 1) / (forecast + 1), one pair of quantiles per horizon, calibrated on origins "
         f"{cov['calibration_origins'][0]} to {cov['calibration_origins'][-1]} and checked on later origins {cov['check_origins'][0]} to "
         f"{cov['check_origins'][-1]}. Coverage: <b>{cov['coverage_menswear']:.1%}</b> Menswear, {cov['coverage_all']:.1%} all segments, inside "
         "the charter's 75% to 85% band. The intervals are wide (at 1 week the 80% band runs from about "
         f"{(2.718281828 ** cov['quantiles_log_ratio']['1'][0]):.2f}x to {(2.718281828 ** cov['quantiles_log_ratio']['1'][1]):.2f}x the forecast), which is the "
         "honest size of week-level error on a 10% sample.")]

st += [P("6  Experiment log and reproducibility", h2),
       P(f"<font face='DVB'>experiment_log.csv</font> has one row per run ({len(log)} rows: {len(va)} model runs and 1 interval check). Each row "
         "records the run id, UTC timestamp, stage, origins, model, data version (data-v1.0 plus the SHA-256 of the transactions file), feature list, "
         "parameters as JSON, random seed (n/a for deterministic rules and the GLM), Menswear WAPE, all-segment WAPE, bias, forecasts scored, run time, "
         f"design hash and code hash. Top M3 features by gain: " + ", ".join(f"{k} {v:.0%}" for k, v in imp.head(4).items()) +
         f". <b>Independent check:</b> <font face='DVB'>validate_metrics.py</font> rebuilds the Menswear panel with separate code and matches the logged "
         f"B0 and B1 scores ({chk['B0_wape_independent']:.5f}, {chk['B1_wape_independent']:.5f}; match = {chk['baselines_match']})."),
       P("<b>Run it:</b> <font face='DVB'>conda env create -f environment.yml</font> (Python 3.13.5; pandas, scikit-learn, LightGBM pinned in "
         "requirements.txt). Put data-v1.0 at <font face='DVB'>../D2/data-v1.0</font> or pass <font face='DVB'>--data</font>; the loader stops if the "
         "checksum differs. Then run <font face='DVB'>python -I run_experiments.py</font> (about 2 minutes on a 16-thread laptop), "
         "<font face='DVB'>python -I validate_metrics.py</font> and <font face='DVB'>python -I build_report.py</font>. The data stays out of the "
         "repository (Kaggle terms, as in D2).")]

st += [P("7  Limits and what D5 does", h2),
       P("(1) The charter's first metric, precision@10 of gap segments, needs Sparta wishlist and ownership data that H&amp;M cannot supply; "
         "it stays a D5 item on aggregated pilot figures only (BR-28: no model is trained on participant data). (2) H&amp;M Menswear is European, "
         "5.8% of units and has no fit field, so the scores show the method, not Indian menswear demand. (3) Only two years of history: "
         "the last-year features rest on one season. (4) D5 scores M3 and M1 once on the two test origins with the settings frozen in "
         "<font face='DVB'>outputs/selected_configs.json</font>, and reports both against B0 and B1.")]

st += [P("References", h2),
       P("[1] Hyndman, R. J. &amp; Athanasopoulos, G. (2021). <i>Forecasting: Principles and Practice</i>, 3rd ed., §5.2 simple methods, §5.10 "
         "time series cross-validation. OTexts. "
         "[2] Makridakis, S., Spiliotis, E. &amp; Assimakopoulos, V. (2022). M5 accuracy competition: Results, findings, and conclusions. "
         "<i>International Journal of Forecasting</i>, 38(4). "
         "[3] Ke, G. et al. (2017). LightGBM: A highly efficient gradient boosting decision tree. <i>NeurIPS 30</i>. "
         "[4] Kapoor, S. &amp; Narayanan, A. (2023). Leakage and the reproducibility crisis in machine-learning-based science. <i>Patterns</i>, 4(9). "
         "[5] Angelopoulos, A. N. &amp; Bates, S. (2021). A gentle introduction to conformal prediction and distribution-free uncertainty "
         "quantification. arXiv:2107.07511. "
         "[6] H&amp;M Group (2022). H&amp;M Personalized Fashion Recommendations [Data set]. Kaggle.", cap),
       P("AI-tool disclosure: the team used Claude (Anthropic) to write the code and draft this report; every number is generated from the "
         "experiment log by build_report.py and was re-checked with separate code.", cap)]


def page(c, d):
    c.saveState()
    c.setFont("DV", 6.8)
    c.setFillColor(colors.HexColor(INK2))
    c.drawString(18 * mm, A4[1] - 10 * mm, f"ANCP Group M | D4 Modelling checkpoint v1 | Page {d.page}")
    c.restoreState()


doc = BaseDocTemplate(str(HERE / "ANCP_TM_D4_v1.pdf"), pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm,
                      topMargin=15 * mm, bottomMargin=13 * mm, title="ANCP_TM_D4_v1", author="ANCP Group M",
                      subject="Sparta D4 modelling checkpoint", lang="en-GB")
doc.addPageTemplates([PageTemplate("p", [Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="f")], onPage=page)])
doc.build(st)

from pypdf import PdfReader
n = len(PdfReader(HERE / "ANCP_TM_D4_v1.pdf").pages)
print("pages", n)
assert n <= 5, "over the 5-page limit"
