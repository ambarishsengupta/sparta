# WO-0073 mutation proof (R5b)

Method: a scratch copy of the repository OUTSIDE the repo (rsync without `.git`, `node_modules`, `.next`, `data`; `node_modules` symlinked); the script `mutate.py` lives in the session scratchpad, not in the repository. One edit to one file per mutant, then `vitest run` over the five unit suites of this work order (`image-prep.test.ts`, `photo-flow.test.ts`, `photo-repository.test.ts`, `components/wardrobe/photo.test.ts`, `source.test.ts`). Baseline: 108 tests pass.

Result: 39 mutants, 39 killed, 0 survived. A first run left one mutant alive (M21: the failed-job sentence changed to contain internal text); a test pinning the exact fixed sentences and forbidding internal words was added (never a test weakened) and the whole table was run again: 39 of 39.

| Mutant | Change | Result | Caught by (file; first failing test) |
| --- | --- | --- | --- |
| M01 | image-prep: upload cap 4.5 MB -> 6 MB | KILLED | image-prep.test.ts; the limits are the documented ones |
| M02 | image-prep: long side 1200 -> 2400 | KILLED | image-prep.test.ts; the limits are the documented ones |
| M03 | image-prep: fitWithin may enlarge | KILLED | image-prep.test.ts; never makes a small picture larger |
| M04 | image-prep: a blob exactly at the cap is refused | KILLED | image-prep.test.ts; steps down the quality when the result is too large, then keeps the first one that fits |
| M05 | image-prep: accepts a blob of the wrong type | KILLED | image-prep.test.ts; falls back to JPEG when the browser cannot write WebP (it answers with another type), and stops asking for Web |
| M06 | image-prep: non-image input not refused | KILLED | image-prep.test.ts; refuses a file that is not an image before decoding anything |
| M07 | image-prep: decoded picture never closed | KILLED | image-prep.test.ts; re-encodes as WebP at most 1,200 pixels on the long side with the first quality, and closes the decoded pictur |
| M08 | image-prep: lowest quality 0.55 -> 0.2 | KILLED | image-prep.test.ts; the limits are the documented ones |
| M09 | image-prep: oversize source limit removed | KILLED | image-prep.test.ts; refuses a source larger than the limit without decoding it |
| M10 | photo-flow: never times out | KILLED | photo-flow.test.ts; gives up at the hard timeout with the timeout sentence, after a bounded number of reads |
| M11 | photo-flow: result paths of other users accepted | KILLED | photo-flow.test.ts; refuses a result with a path outside the owner's folder, a nested or odd path, or a missing field |
| M12 | photo-flow: embedding length not checked (32) | KILLED | photo-flow.test.ts; drops a garment whose numbers are not sound: wrong count, NaN, a string, another model version, a missing vers |
| M13 | photo-flow: any category pair is suggested | KILLED | photo-flow.test.ts; a pair that is not in the taxonomy suggests nothing |
| M14 | photo-flow: read failures never end the wait early | KILLED | photo-flow.test.ts; a dropped connection during the wait ends after three reads in a row fail, but one failure in between is forgi |
| M15 | photo-flow: a failed job is not recognised | KILLED | photo-flow.test.ts; a failed job gives the fixed failure sentence and never the stored error text |
| M16 | photo-flow: garment label without a pair | KILLED | photo.test.ts,photo-flow.test.ts; a garment without a category pair also pre-fills nothing |
| M17 | photo-flow: keep-original stores the cut-out | KILLED | photo-flow.test.ts; accepting the cut-out stores the cut-out and its thumbnail; keeping the original stores the original and its t |
| M18 | photo-flow: abortable sleep leaves its timer | KILLED | photo-flow.test.ts; an abort ends it at once and clears the timer (the page was left) |
| M19 | photo-flow: last sleep may pass the deadline | KILLED | photo-flow.test.ts; the last sleep never goes past the deadline |
| M20 | photo-flow: abort during the read is ignored | KILLED | photo-flow.test.ts; an abort while the last read is in flight discards its answer |
| M21 | photo-flow: failed-job text shown from the job | KILLED | photo-flow.test.ts; the sentences shown for a failed or slow photo are the fixed ones, in plain words |
| M22 | photo-flow: features kept without a garment pair check on class | KILLED | photo-flow.test.ts; an out-of-range class or probability is stored as null, not as given |
| M23 | mapping: photo items stored as manual | KILLED | photo-repository.test.ts; a photo item has origin photo and its two image paths, and no photo or features object leaks into the row |
| M24 | mapping: image paths not stored | KILLED | photo-repository.test.ts; a photo item has origin photo and its two image paths, and no photo or features object leaks into the row |
| M25 | mapping: 32 numbers not enforced | KILLED | photo-repository.test.ts; builds the item_features row for version 1: 32 numbers, class, p, the owner and the item |
| M26 | mapping: NaN numbers allowed | KILLED | photo-repository.test.ts; refuses what the table would refuse: unknown version, wrong count for the version, NaN or Infinity, class or p |
| M27 | repository: features stored under the item id as owner | KILLED | photo-repository.test.ts; writes the item with origin photo and then its features row for the same item and owner |
| M28 | repository: a features failure fails the save | KILLED | photo-repository.test.ts; a features row the server refuses does not undo or fail the save |
| M29 | repository: features written for every photo item | KILLED | photo-repository.test.ts; writes NO features row when the result had none (the guess switch is off) |
| M30 | ItemForm: label stays after the person changes the value | KILLED | photo.test.ts; the label is tied to the unchanged suggestion: the source drops it once the value differs |
| M31 | ItemForm: garment label without a suggestion | KILLED | photo.test.ts; a result WITHOUT a garment (the default) shows NO garment suggestion: empty category and sub-type, no label |
| M32 | PhotoItemFlow: wait not stopped on unmount | KILLED | photo.test.ts; stops the wait when the page is left: aborts the controller in the effect cleanup, and polls with no interval  |
| M33 | PhotoItemFlow: opens without the account backend | KILLED | photo.test.ts; without the account backend it says so and offers the manual form; it has no file input |
| M34 | photo-backend: upload may overwrite | KILLED | photo.test.ts; uploads into item-images directly under the owner folder with a random name, the encoded type, and no overwrit |
| M35 | photo-backend: upload outside the owner folder | KILLED | photo.test.ts; uploads into item-images directly under the owner folder with a random name, the encoded type, and no overwrit |
| M36 | photo-backend: wrong job type | KILLED | photo.test.ts; creates the job with exactly user_id, type photo and the path as input, and returns its numeric id |
| M37 | photo-backend: preview links last a day | KILLED | photo.test.ts; the source asks for 10-minute links and for nothing else from storage |
| M38 | photo-backend: wrong content type | KILLED | photo.test.ts; uploads into item-images directly under the owner folder with a random name, the encoded type, and no overwrit |
| M39 | photo-backend: orientation not applied | KILLED | photo.test.ts; decodes with the picture's own orientation applied |