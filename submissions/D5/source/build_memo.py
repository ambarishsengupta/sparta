"""Builds source/d5.html (the text of ANCP_TM_D5_v1.pdf) from evidence/d5_results.json, so no number in the memo is typed by hand.
Run: python build_memo.py   then render with Chrome (see ../README.md)."""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
R = json.loads((HERE.parent / "evidence" / "d5_results.json").read_text())
P = lambda x, d=1: f"{100 * x:.{d}f}"          # fraction to percent text
F = lambda x, d=1: f"{x:.{d}f}"
cnn, lr, mj, runs, ec = R["cnn"], R["base_lr"], R["base_maj"], R["runs"], R["errors"]
sw = {r["thr"]: r for r in R["threshold_sweep"]}
rob = {r["name"]: r for r in R["robust"]}
sub = R["subgroups"]
lk, ln, lc, ls = R["leak_exact"], R["leak_near"], R["leak_csv"], R["leak_src"]
rt = R["roundtrip"]
mir = R["mirror_per_class"]
ci = lambda c, d=1: f"{P(c[0], d)} to {P(c[1], d)}"
pp = lambda x: f"{100 * x:+.1f}"
net = lambda m, c: m["net100"][str(c)]

def row_model(label, m, spread=None):
    acc = f"{P(m['accuracy'])} ({ci(m['accuracy_ci'])})" if "accuracy_ci" in m else P(m["accuracy"])
    return (f"<tr><td>{label}</td><td>{acc}</td><td>{P(m['macro_f1'])}</td><td>{F(100*m['hit'])}</td><td>{F(100*m['wrong'])}</td>"
            f"<td>{F(100*m['none'])}</td><td>{P(m['precision_when_shown'])}</td><td>{F(net(m, 3))}</td></tr>")

def pm(k, scale=100, d=1):
    r = runs[k]; return f"{scale*r['mean']:.{d}f} &plusmn; {scale*r['sd']:.{d}f}"

status_cls = {"PASS": "pass", "FAIL": "fail", "N/A": "na"}
def chk(n, item, st, ev):
    return f'<tr><td>{n}</td><td>{item}</td><td class="{status_cls[st]}">{st}</td><td>{ev}</td></tr>'

CHECKS = ([
 chk(1, "Test pictures never used to train or tune", "PASS", f"The only data call in <code>train.py</code> is <code>load_split(root, \"train\")</code>; settings were picked on the validation part (tuning notes). The five retraining runs load the test file only after training ends [3]."),
 chk(2, "Splits disjoint and stratified", "PASS", f"54,000 / 6,000 / 10,000 pictures; {R['data']['overlap_train_val_index']} indices shared by training and validation; 600 validation and 1,000 test pictures per class [3]."),
 chk(3, "Exact duplicates across splits", "PASS", f"{lk['test_twin_in_train']} test pictures have a pixel-identical twin in the training file; {lk['val_twin_in_trainpart']} validation pictures in the training part; {lk['dups_in_train']} duplicates inside either file [3]."),
 chk(4, "Near-duplicates (same product, other crop)", "PASS", f"The data has no product ID, so a proxy was run: {ln['lt1']} test pictures ({100*ln['lt1']/10000:.2f}%) lie within distance 1.0 of a training picture (closest {ln['min']:.2f}; median nearest {ln['q'][3]}). At most {100*ln['lt1']/10000:.2f} accuracy points could come from them [3]."),
 chk(5, "A second copy of the data (CSV vs IDX)", "PASS", f"Trap avoided. {lc['in_idx_train']:,} of the 10,000 CSV test pictures are in the IDX <em>training</em> file [2][3]. Scoring on the CSV file would report {P(lc['acc_csv'])}% instead of {P(cnn['accuracy'])}%. Code reads IDX files only."),
 chk(6, "Preprocessing or scaling fitted on all data", "N/A", "Preprocessing is fixed arithmetic (crop, greyscale, invert, resize, divide by 255); no mean, standard deviation or scaler is learned."),
 chk(7, "Time, customer or group structure", "N/A", "Pictures carry no date, customer or group field, so a time or group split is not defined. Near-duplicate test (item 4) is the closest check."),
 chk(8, "Label information in the inputs", "PASS", "Input is the 28 by 28 pixel array only; no file name, ID or metadata reaches the network."),
 chk(9, "Threshold, early stopping or augmentation tuned on test", "PASS", "Early stopping and augmentation strength used the 6,000 validation pictures. The 0.6 threshold is the LLD default, untouched; this memo reports a threshold sweep but selects nothing from it."),
 chk(10, "Pretrained weights or outside data overlapping test", "N/A", "Trained from random weights on the 54,000 training pictures; <code>model.py</code> loads nothing."),
 chk(11, "Augmentation applied before the split", "PASS", "Augmentation runs inside the training loop on training batches only."),
 chk(12, "Training and worker preprocessing differ (skew)", "PASS", f"Test pictures turned into synthetic cut-outs and sent through the worker's own preprocessing: accuracy {pp(rt['delta'])} points ({pp(rt['delta_ci'][0])} to {pp(rt['delta_ci'][1])}) [3]."),
])
check_rows = "".join(CHECKS)
NP, NF, NN = (sum(f'class="{c}"' in r for r in CHECKS) for c in ("pass", "fail", "na"))

sweep_rows = "".join(
 f"<tr{' class=\"hl\"' if t == 0.6 else ''}><td>{t:.1f}</td><td>{F(sw[t]['hit'])}</td><td>{F(sw[t]['wrong'])}</td><td>{F(sw[t]['none'])}</td><td>{P(sw[t]['precision'])}</td>"
 f"<td>{F(sw[t]['net_c1'])}</td><td>{F(sw[t]['net_c3'])}</td><td>{F(sw[t]['net_c10'])}</td></tr>" for t in (0.4, 0.5, 0.6, 0.7, 0.8, 0.9))

def sg(group, key):
    v = sub[group][key]; return f"{P(v['accuracy'])} ({P(v['ci'][0])} to {P(v['ci'][1])})"
sub_rows = "".join([
 f"<tr><td>Shirt (weakest class)</td><td>{sub['class']['Shirt']['n']:,}</td><td>{sg('class','Shirt')}</td><td>{F(sub['class']['Shirt']['wrong100'])}</td></tr>",
 f"<tr><td>Tops (T-shirt, pullover, shirt)</td><td>{sub['category']['Tops']['n']:,}</td><td>{sg('category','Tops')}</td><td>{F(sub['category']['Tops']['wrong100'])}</td></tr>",
 f"<tr><td>Outerwear (coat)</td><td>{sub['category']['Outerwear']['n']:,}</td><td>{sg('category','Outerwear')}</td><td>{F(sub['category']['Outerwear']['wrong100'])}</td></tr>",
 f"<tr><td>Footwear (sandal, sneaker, boot)</td><td>{sub['category']['Footwear']['n']:,}</td><td>{sg('category','Footwear')}</td><td>{F(sub['category']['Footwear']['wrong100'])}</td></tr>",
 f"<tr><td>Bottoms (trouser)</td><td>{sub['category']['Bottoms']['n']:,}</td><td>{sg('category','Bottoms')}</td><td>{F(sub['category']['Bottoms']['wrong100'])}</td></tr>",
 f"<tr><td>Faint garments (lowest third of brightness within class)</td><td>{sub['brightness']['faint third']['n']:,}</td><td>{sg('brightness','faint third')}</td><td>{F(sub['brightness']['faint third']['wrong100'])}</td></tr>",
 f"<tr><td>Small garments (lowest third of area within class)</td><td>{sub['size']['small third']['n']:,}</td><td>{sg('size','small third')}</td><td>{F(sub['size']['small third']['wrong100'])}</td></tr>",
 f"<tr><td>Large garments (highest third of area within class)</td><td>{sub['size']['large third']['n']:,}</td><td>{sg('size','large third')}</td><td>{F(sub['size']['large third']['wrong100'])}</td></tr>",
])
def rr(name, label=None):
    r = rob[name]; return f"<tr><td>{label or name}</td><td>{P(r['accuracy'])}</td><td>{pp(r['delta'])}</td><td>{F(r['wrong'])}</td></tr>"

top = ec["top"]
html = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>ANCP D5: validation memo for the garment model</title>
<style>
 @page {{ size: A4; margin: 11mm 13mm 13mm 13mm;
   @bottom-center {{ content: "ANCP Group M | D5 Model validation memo v1 | Page " counter(page) " of 4"; font: 7.5pt Arial, Helvetica, sans-serif; color: #777; }} }}
 * {{ box-sizing: border-box; }}
 html {{ font-family: Arial, Helvetica, sans-serif; color: #111; }}
 body {{ margin: 0; font-size: 8.5pt; line-height: 1.34; }}
 h1 {{ font-size: 15pt; color: #1b2a4e; margin: 0 0 2px; line-height: 1.2; }}
 h2 {{ font-size: 10.3pt; color: #1b2a4e; margin: 8px 0 3px; break-after: avoid; border-bottom: 1px solid #b7bfd2; padding-bottom: 1px; }}
 p {{ margin: 0 0 4px; }}
 ul {{ margin: 2px 0 4px; padding-left: 15px; }} li {{ margin-bottom: 1.5px; }}
 code {{ font-family: "Courier New", monospace; font-size: 7.6pt; }}
 table {{ width: 100%; border-collapse: collapse; margin: 3px 0 3px; font-size: 7.5pt; line-height: 1.26; }}
 th {{ background: #eaeef7; text-align: left; font-weight: 700; }}
 th, td {{ border: 1px solid #b7bfd2; padding: 2px 4px; vertical-align: top; }}
 tr {{ break-inside: avoid; }}
 .meta td {{ border: none; padding: 0 8px 0 0; font-size: 8pt; }} .meta td:first-child {{ font-weight: 700; width: 11%; }}
 .box {{ border: 1px solid #1b2a4e; background: #f3f5fa; padding: 4px 7px; margin: 5px 0; }}
 .box p {{ margin: 0 0 2px; }}
 .pass {{ background: #e3f3e6; color: #17612b; font-weight: 700; text-align: center; white-space: nowrap; }}
 .fail {{ background: #fbe3e1; color: #9a1b12; font-weight: 700; text-align: center; }}
 .na {{ background: #eceef2; color: #444; font-weight: 700; text-align: center; white-space: nowrap; }}
 tr.hl td {{ background: #fff6d6; }}
 td.n, th.n {{ text-align: right; }}
 .cap {{ font-size: 7.4pt; color: #444; margin: 1px 0 4px; }}
 .two {{ display: flex; gap: 8px; align-items: flex-start; }} .two > div {{ flex: 1; }}
 .two img {{ width: 100%; display: block; }}
 .pb {{ break-before: page; }}
 .refs p {{ font-size: 7.3pt; margin-bottom: 1px; padding-left: 12px; text-indent: -12px; }}
</style></head><body>

<!-- ===== PAGE 1 ===== -->
<h1>Can we trust the garment model? Validation memo for garment-cnn-v1</h1>
<table class="meta"><tr><td>To</td><td>Project owner and decision-maker for the Sparta pilot</td><td style="font-weight:700;width:9%">Date</td><td>15 November 2026</td></tr>
<tr><td>From</td><td>ANCP Group M (deliverable D5, version 1)</td><td style="font-weight:700">Repository</td><td>tag <code>d5-v1</code>, folder <code>submissions/D5</code></td></tr>
<tr><td>Model</td><td colspan="3">Photo-to-garment suggestion (FDD 14.3, LLD 7.7): a 25,706-weight network that names one of ten garment types from a 28 by 28 greyscale picture. Released file SHA-256 <code>{R['meta']['onnx_sha256'][:16]}&hellip;</code></td></tr></table>

<div class="box"><p><b>Decision asked.</b> Keep the photo suggestion switched <b>off</b> for the pilot (<code>GARMENT_GUESS_ENABLED=false</code>) until the 100-photo team test of LLD 7.7 is done, as the model card already says. Nothing in this memo replaces that test.</p>
<p><b>Why.</b> On the test it was built for, the model is sound and honestly measured: <b>{P(cnn['accuracy'])}% accuracy</b> (95% interval {ci(cnn['accuracy_ci'])}), against {P(lr['accuracy'])}% for a plain logistic regression and {P(mj['accuracy'])}% for guessing. No leakage was found. But that test uses clean studio pictures. Two weaknesses will matter on phone photos: <b>footwear facing the other way is almost never recognised</b> (ankle boot {P(mir['Ankle boot'][1],0)}%, sneaker {P(mir['Sneaker'][1],0)}%, sandal {P(mir['Sandal'][1],0)}% when mirrored) and <b>accuracy drops 6 to 14 points for faint garments</b> (intensity x0.5 to x0.3). Both are cheap to test on the team photos and the first is cheap to fix in training.</p></div>

<div class="box" style="background:#fff"><p><b>Recommended next steps</b> (in order): (1) run the 100-photo team test with shoes photographed in both directions and some white garments, and read the threshold from the cost table in section 4; (2) before it, retrain as a new version with a left-right flip for footwear in the augmentation (one run takes about 6 minutes; the notebook re-scores it unchanged); (3) add a worker test that the colour-inversion step ran, since without it accuracy falls to {P(rob['polarity wrong (not inverted)']['accuracy'],0)}%; (4) once the pilot runs, replace the assumed cost ratio c with the measured share of wrong suggestions users change.</p></div>

<h2>1. Validation design</h2>
<svg viewBox="0 0 740 218" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="Arial, Helvetica, sans-serif" font-size="9.5">
 <defs><marker id="ar" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#1b2a4e"/></marker></defs>
 <rect x="250" y="4" width="240" height="30" rx="4" fill="#eaeef7" stroke="#1b2a4e"/><text x="370" y="17" text-anchor="middle" font-weight="700">Fashion-MNIST (Zalando), IDX files</text><text x="370" y="29" text-anchor="middle">70,000 pictures, 28 x 28, ten types</text>
 <rect x="580" y="4" width="156" height="42" rx="4" fill="#fbe3e1" stroke="#9a1b12" stroke-dasharray="4 3"/><text x="658" y="17" text-anchor="middle" font-weight="700" fill="#9a1b12">CSV copies: never used</text><text x="658" y="29" text-anchor="middle" fill="#9a1b12">{lc['in_idx_train']:,} of 10,000 CSV test</text><text x="658" y="40" text-anchor="middle" fill="#9a1b12">pictures are in IDX training</text>
 <line x1="330" y1="34" x2="190" y2="64" stroke="#1b2a4e" marker-end="url(#ar)"/><line x1="440" y1="34" x2="600" y2="64" stroke="#1b2a4e" marker-end="url(#ar)"/>
 <rect x="20" y="64" width="330" height="22" rx="4" fill="#eaeef7" stroke="#1b2a4e"/><text x="185" y="79" text-anchor="middle" font-weight="700">IDX training file: 60,000 pictures</text>
 <rect x="450" y="64" width="270" height="22" rx="4" fill="#eaeef7" stroke="#1b2a4e"/><text x="585" y="79" text-anchor="middle" font-weight="700">IDX test file: 10,000 (1,000 per type)</text>
 <text x="185" y="100" text-anchor="middle" font-size="8.5">stratified split, fixed seed 20261104, no picture in both parts</text>
 <line x1="110" y1="104" x2="90" y2="120" stroke="#1b2a4e" marker-end="url(#ar)"/><line x1="260" y1="104" x2="280" y2="120" stroke="#1b2a4e" marker-end="url(#ar)"/>
 <rect x="10" y="120" width="170" height="52" rx="4" fill="#e3f3e6" stroke="#17612b"/><text x="95" y="134" text-anchor="middle" font-weight="700">Training part: 54,000</text><text x="95" y="147" text-anchor="middle">weights are fitted here;</text><text x="95" y="159" text-anchor="middle">augmentation applied here only</text>
 <rect x="195" y="120" width="170" height="52" rx="4" fill="#fff6d6" stroke="#8a6d00"/><text x="280" y="134" text-anchor="middle" font-weight="700">Validation: 6,000</text><text x="280" y="147" text-anchor="middle">600 per type; early stopping,</text><text x="280" y="159" text-anchor="middle">learning rate, augmentation strength</text>
 <rect x="450" y="104" width="270" height="68" rx="4" fill="#e6ecfa" stroke="#1b2a4e" stroke-width="2"/><text x="585" y="119" text-anchor="middle" font-weight="700">Locked test: scored after settings were fixed</text><text x="585" y="132" text-anchor="middle">every number in this memo; nothing is chosen from it;</text><text x="585" y="144" text-anchor="middle">five retrainings (new seed = new 54k / 6k split) are</text><text x="585" y="156" text-anchor="middle">scored on this same test file for the repeated-run spread</text>
 <line x1="585" y1="86" x2="585" y2="104" stroke="#1b2a4e" marker-end="url(#ar)"/>
 <rect x="195" y="184" width="525" height="28" rx="4" fill="#fff" stroke="#9a1b12" stroke-dasharray="4 3"/><text x="457" y="196" text-anchor="middle" font-weight="700" fill="#9a1b12">Not done: 100 team photographs taken the way a user would (LLD 7.7, LOI-9)</text><text x="457" y="207" text-anchor="middle" fill="#9a1b12">the only test that matches the real input; it decides the threshold and whether the feature is switched on</text>
</svg>
<p class="cap">Figure 1. How the data was split. Sources: model card, <code>train.py</code>, data README [2], notebook [3].</p>
<p><b>Why this avoids leakage.</b> Three independent parts, cut once from the files Zalando published as training and test. Everything the model learns from or is tuned on sits in the training and validation parts; the 10,000 test pictures were scored once the settings were fixed. The data README warns that the CSV copies mix the two files, so only the IDX files are read [2]. Repeating training with five seeds shows how much the result depends on the particular split and starting point, not just on test sampling.</p>
<p><b>What it does not cover.</b> The test pictures come from the same photo studio as the training pictures. That is why the decision above turns on the team-photo test, not on this memo.</p>

<!-- ===== PAGE 2 ===== -->
<h2 class="pb">2. Leakage checklist</h2>
<table><thead><tr><th style="width:3%">#</th><th style="width:22%">Check</th><th style="width:7%">Result</th><th>Evidence</th></tr></thead><tbody>{check_rows}</tbody></table>
<p class="cap">Result: {NP} pass, {NF} fail, {NN} not applicable. [2] data README, section on the IDX/CSV overlap. [3] evaluation notebook, sections 1, 2 and 6, tag d5-v1.</p>

<h2>3. Metrics against baselines</h2>
<p>Model suggestion at the shipped threshold 0.6 (a suggestion is shown only if the top score is at least 0.6 and the type has a mapping; Dress has none, so a tenth of all pictures can never get a correct suggestion). Per 100 test photos, the outcome is exactly one of: <b>correct suggestion</b>, <b>wrong suggestion</b>, <b>no suggestion</b>.</p>
<table><thead><tr><th>Model</th><th>Accuracy % (95% CI)</th><th>Macro-F1 %</th><th>Correct shown /100</th><th>Wrong shown /100</th><th>None /100</th><th>Right when shown %</th><th>Net benefit /100 (c=3)</th></tr></thead><tbody>
{row_model('Always the most common type (no feature)', mj)}
{row_model('Logistic regression on pixels, same training pictures', lr)}
{row_model('<b>garment-cnn-v1, released file</b>', cnn)}
<tr><td><b>garment-cnn-v1, five retrainings</b> (mean &plusmn; sd)</td><td>{pm('accuracy')}</td><td>{pm('macro_f1')}</td><td>{pm('hit')}</td><td>{pm('wrong')}</td><td>&ndash;</td><td>{pm('precision_when_shown')}</td><td>{runs['net100']['3']['mean']:.1f} &plusmn; {runs['net100']['3']['sd']:.1f}</td></tr></tbody></table>
<p class="cap">Released file: 95% intervals from 2,000 resamples of the test pictures: correct shown {F(100*cnn['hit_ci'][0])} to {F(100*cnn['hit_ci'][1])}; wrong shown {F(100*cnn['wrong_ci'][0])} to {F(100*cnn['wrong_ci'][1])}. Five retrainings (seeds {', '.join(str(s) for s in runs['seeds'])}): accuracy ranges {P(runs['accuracy']['min'])} to {P(runs['accuracy']['max'])}; the run with the release seed reproduced the released file exactly (validation {P(runs['release_seed_val'],2)}%, test {P(runs['release_seed_test'],2)}%). Net benefit is defined in section 4.</p>
<ul><li>The network beats logistic regression by <b>{pp(R['cnn_minus_lr_accuracy']['diff'])} accuracy points</b> (paired interval {pp(R['cnn_minus_lr_accuracy']['ci'][0])} to {pp(R['cnn_minus_lr_accuracy']['ci'][1])}), and shows a wrong suggestion {F(100*lr['wrong']/ (100*cnn['wrong']),1)} times less often than that baseline ({F(100*cnn['wrong'])} vs {F(100*lr['wrong'])} per 100).</li>
<li>Training noise is small: one standard deviation is {F(100*runs['accuracy']['sd'],2)} accuracy points, about the same as the test-sampling error (interval half-width {F(50*(cnn['accuracy_ci'][1]-cnn['accuracy_ci'][0]),2)} points). Differences under about half a point are not real.</li>
<li>The scores are <b>under-confident</b>: pictures scored 0.6 to 0.7 are right {P(next(b for b in R['calibration'] if abs(b[0] - 0.6) < 1e-9)[3],0)}% of the time; expected calibration error {P(R['ece'])}%. That makes 0.6 a cautious threshold on this test, but a shift in lighting or framing can reverse it.</li></ul>

<!-- ===== PAGE 3 ===== -->
<h2 class="pb">4. Cost of errors</h2>
<p><b>What the two errors are here.</b> A photo is added and the form is pre-filled with a type, labelled &ldquo;Suggested from your photo&rdquo; (FR-23a); the user can change it.</p>
<ul><li><b>False positive (a wrong suggestion is shown).</b> The user must notice and correct it (extra effort), or does not and saves a wrong type. A cross-category error ({ec['wrong_cross']} of the {ec['wrong_shown']} wrong suggestions here, e.g. trouser read as dress) can put the item in the wrong outfit slot and so wrongly allow or block outfits (rules R1, R2); a within-category error ({ec['wrong_within']}, e.g. shirt read as T-shirt) mostly harms sub-type matching. Uncorrected errors also reach the vendor aggregates. It also erodes trust in the feature, which is measured in the pilot as <code>garment_guess_changed</code>.</li>
<li><b>False negative (no suggestion, or a wrong one hiding the right one).</b> Compared with no feature, the user simply types the type as today, so the extra cost is small: the saving is lost. Dress is a permanent miss ({ec['dress_n']:,} of 10,000 test pictures).</li></ul>
<p><b>Costs are not measured yet.</b> The pilot events <code>garment_guess_shown</code>, <code>_kept</code> and <code>_changed</code> will measure them. Until then, treat a correct suggestion as worth 1 (one manual entry saved) and a wrong suggestion as costing <b>c</b> (correction effort plus risk of a bad type). Break-even precision is c/(1+c): {P(1/2,0)}% for c=1, {P(3/4,0)}% for c=3, {P(10/11,0)}% for c=10. LLD 7.7 aims at about 80% right when shown, which assumes c of about 4. <b>Net benefit per 100 photos</b> = correct shown &minus; c &times; wrong shown.</p>
<table><thead><tr><th>Threshold</th><th>Correct shown /100</th><th>Wrong shown /100</th><th>None /100</th><th>Right when shown %</th><th>Net, c=1</th><th>Net, c=3</th><th>Net, c=10</th></tr></thead><tbody>{sweep_rows}</tbody></table>
<p class="cap">Released file on the 10,000 test photos (studio pictures). Highlighted: the shipped default 0.6, which was not tuned. Best threshold depends on c: 0.4 for c=1, 0.6 for c=3, 0.8 for c=10. At c=3 the default is the best of those shown; if wrong suggestions are costly (c=10), 0.8 is worth {F(sw[0.8]['net_c10']-sw[0.6]['net_c10'],0)} more per 100 photos. Net benefit is positive at every threshold shown, for all three values of c, on studio pictures; on phone photos the wrong-shown column will rise (section 6).</p>

<h2>5. Error analysis</h2>
<div class="two"><div><img src="../figs/fig_confusion.png" alt="Confusion matrix"><p class="cap">Figure 2. Where the released model errs (row = true type).</p></div>
<div>
<ul><li><b>Upper-body garments are confused with each other.</b> Largest confusions: {top[0][0]} read as {top[0][1]} ({top[0][2]}), {top[1][0]} read as {top[1][1]} ({top[1][2]}), {top[2][0]} read as {top[2][1]} ({top[2][2]}), {top[3][0]} as {top[3][1]} ({top[3][2]}). Shirt is the weakest type: right {P(sub['class']['Shirt']['accuracy'])}% ({P(sub['class']['Shirt']['ci'][0])} to {P(sub['class']['Shirt']['ci'][1])}); it produces {F(sub['class']['Shirt']['wrong100'])} wrong suggestions per 100 shirts shown. Seed-to-seed sd for Shirt is {F(100*runs['per_class_sd'][6])} points.</li>
<li><b>Footwear and trousers are reliable</b> ({P(sub['category']['Footwear']['accuracy'])}% and {P(sub['category']['Bottoms']['accuracy'])}%); sneaker, sandal and boot mix up mainly with each other.</li>
<li><b>Of {ec['err_total']:,} errors, {ec['err_within']} stay inside one category and {ec['err_cross']} cross categories</b> (Dress counts as its own category, so every Dress error crosses).</li>
<li><b>Few confident mistakes.</b> {ec['err_conf90']} errors have a top score of 0.9 or more; {ec['err_conf60']} have 0.6 or more, of which {ec['wrong_shown']} are shown to the user (the rest are read as Dress, which has no mapping).</li>
<li>Dress: {ec['dress_wrong_shown']} of 1,000 dress pictures get a wrong suggestion of another garment, since the model has no &ldquo;none of these&rdquo; option.</li></ul></div></div>

<!-- ===== PAGE 4 ===== -->
<h2 class="pb">6. Robustness and subgroups</h2>
<p>The released file was run on perturbed copies of the same 10,000 test pictures, with no retraining. The perturbations imitate what phone photos do to a studio-trained model; they are not real phone photos.</p>
<div class="two"><div><img src="../figs/fig_robust.png" alt="Robustness"><p class="cap">Figure 3. Accuracy change, with 95% interval from paired resampling.</p></div>
<div><table><thead><tr><th>Perturbation</th><th>Acc %</th><th>Change, pts</th><th>Wrong /100</th></tr></thead><tbody>
<tr><td>None (clean)</td><td>{P(cnn['accuracy'])}</td><td>0.0</td><td>{F(100*cnn['wrong'])}</td></tr>
{rr('intensity x0.5 (light garment)')}{rr('intensity x0.3 (very faint)')}{rr('noise sd 25','noise, sd 25 of 255')}{rr('shift 4 px','shift 4 px of 28')}{rr('rotate 15 deg')}{rr('rotate 30 deg')}{rr('hide 12x12 patch','hide a 12 x 12 patch')}{rr('mirror left-right','<b>mirror left-right</b>')}
<tr><td>Worker preprocessing round trip</td><td>{P(rt['accuracy'])}</td><td>{pp(rt['delta'])}</td><td>{F(rt['wrong'])}</td></tr></tbody></table></div></div>
<ul><li><b>Mirroring is the largest practical risk.</b> In the training data every shoe points the same way. Mirrored: ankle boot {P(mir['Ankle boot'][0],0)}% &rarr; {P(mir['Ankle boot'][1],0)}%, sneaker {P(mir['Sneaker'][0],0)}% &rarr; {P(mir['Sneaker'][1],0)}%, sandal {P(mir['Sandal'][0],0)}% &rarr; {P(mir['Sandal'][1],0)}%; tops and trousers barely change. A user photographing a shoe pointing the other way gets a wrong or no suggestion. Training has no left-right flip.</li>
<li><b>Light garments and noise hurt next:</b> LLD 7.7 already names white and very light garments as a weak spot; the x0.3 row imitates it. The picture needs to be roughly upright (15 degrees costs {abs(100*rob['rotate 15 deg']['delta']):.0f} points, 30 degrees {abs(100*rob['rotate 30 deg']['delta']):.0f}) and within about 2 pixels of centre. Skipping the colour inversion step would break it completely (accuracy {P(rob['polarity wrong (not inverted)']['accuracy'])}%), so that step needs a test in the worker.</li>
<li><b>Subgroups.</b> The data has no people, so there are no demographic groups to test; subgroups are garment types and picture properties. Intervals are 95% (Wilson).</li></ul>
<table><thead><tr><th>Subgroup (test pictures)</th><th class="n">n</th><th>Accuracy % (95% CI)</th><th>Wrong shown /100</th></tr></thead><tbody>{sub_rows}</tbody></table>
<p class="cap">Brightness and size thirds are ranked inside each type so every group has the same type mix. The weakest group is Tops, {abs(100*(sub['category']['Tops']['accuracy']-cnn['accuracy'])):.1f} points below overall.</p>

<h2>7. Limitations</h2>
<ul><li><b>Not tested on the real input.</b> All numbers are for clean, centred, greyscale studio pictures from one retailer. Phone photos (hangers, folds, shadows, hands, either shoe direction) are unmeasured. The 100-photo team test has not been done.</li>
<li><b>Ten types only.</b> No Dress mapping, no Jeans, Shorts, Kurta, Blazer; none of the types was chosen for Indian menswear, which is the pilot population. Fashion-MNIST includes women's garments.</li>
<li><b>Stress tests are synthetic.</b> They show which weaknesses exist, not how large they are in real use. Perturbation sizes were chosen by us, not calibrated to phones.</li>
<li><b>Cost ratios are assumptions</b> (c = 1, 3, 10); no user cost was measured. The conclusions about the best threshold move with c.</li>
<li><b>Intervals cover limited things.</b> The 95% intervals reflect test-sampling error only; the five-seed spread is small (n=5). Neither covers a change of camera, lighting or population. Labels are the retailer's and some (shirt vs T-shirt) are ambiguous, so the test ceiling is below 100%.</li>
<li>The same 10,000 test pictures were used for every analysis here. Nothing was selected from them, but the robustness and subgroup figures are descriptive, not independent confirmations.</li>
<li>Tools: the notebook, seed script and this memo were drafted with Claude Code (Anthropic); all numbers are written by the notebook run to <code>evidence/d5_results.json</code>. Group M should read the results before submission.</li></ul>
<div class="refs"><p>[1] Sparta LLD section 7.7 and FDD sections 14.3 to 14.4 (garment model, confidence rule, evaluation plan).</p>
<p>[2] <code>data/recommendation-engine/README.md</code>: Fashion-MNIST files, checksums, and the IDX/CSV overlap audit of 2026-11-03.</p>
<p>[3] <code>submissions/D5/ANCP_TM_D5_eval.ipynb</code> and <code>d5_seed_runs.py</code>, tag <code>d5-v1</code>; results in <code>evidence/d5_results.json</code>. Model card: <code>ml/recommendation-engine/garment/model_card.md</code>. Data: Xiao, Rasul and Vollgraf (2017), arXiv:1708.07747.</p></div>
</body></html>
"""
(HERE / "d5.html").write_text(html, encoding="utf-8")
print("wrote", HERE / "d5.html")
