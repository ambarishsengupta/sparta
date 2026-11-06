# WO-0075 notes (R5b): item image paths must belong to the item's owner

## What changed
- New migration `supabase/migrations/20261106130000_wo0075_item_image_paths.sql` (no old migration touched): CHECK constraint `items_image_path_owner_chk` on `app.items`. When `image_path` or `image_thumb_path` is not null it must match `^{user_id}/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$` (one plain file name directly under the row's own owner folder, the same shape `app.job_input_ok` demands of job paths) and must not contain `..`. Slash, backslash, absolute paths, foreign folders, empty names and a trailing newline all fail the pattern. A CHECK (not a trigger) applies to every role, on insert and on any update of either column or of `user_id`. Refusals are SQLSTATE 23514.
- New pgTAP file `supabase/tests/database/011_wo0075_item_image_paths.test.sql`: 55 tests (owner's own paths and null accepted on insert and update; B's folder refused in either column, alone or paired with a good path; `..`, nested, absolute, backslash, empty, leading dot, 129 characters, newline, space, percent, non-ASCII refused; update to a foreign/nested/absolute/`..`/backslash path refused and the stored value unchanged; the session role is bound too; moving a picture-bearing item to another owner is refused).

## Existing rows
`ADD CONSTRAINT` validates every existing row and would fail the migration loudly. The only writer of these columns is the photo flow (`items.create` with `{user_id}/{job id}-cutout.webp` and `-thumb.webp`, `-original.webp`, which all fit the pattern), and the seeds write no paths. The constraint is validated on the rebuilt local database (`convalidated` is asserted by test 1). A hosted database with hand-written rows would need a look before migrating; none exists.

## App check
`items.create` (apps/web/lib/supabase/mapping.ts, photo-repository.ts) sends `photo.imagePath` / `imageThumbPath` straight from the validated job result, which `photo-flow.ts` already restricts to the owner's folder. Real-stack `photo.int.test.ts` saves a cut-out item and a keep-original item against the new constraint (see gate output). No app test needed changing and none was touched.

## Mutation proof (scratch copy, outside the repository)
Method: the mutated constraint is applied inside the transaction of a scratch copy of the pgTAP file (generated in the session scratchpad by `mutate.py`, not in the repo); the constraint is dropped and re-created with one edit, its comment restored so the comment test cannot kill by itself, then the whole file runs against the local stack inside its own rolled-back transaction. Baseline: 55 ok, 0 not ok.

| Mutant | Change | Result | First failing test |
| --- | --- | --- | --- |
| M01 | owner prefix not required (any uuid-shaped folder) | KILLED (14 fail) | A cannot point image_path into B's folder |
| M02 | no `..` refusal | KILLED (3) | two dots inside a name are refused |
| M03 | slash allowed in the name (nested) | KILLED (5) | a nested folder under the owner folder is refused |
| M04 | image_thumb_path not checked | KILLED (10) | A cannot point image_thumb_path into B's folder |
| M05 | image_path not checked | KILLED (31) | A cannot point image_path into B's folder |
| M06 | start anchor removed | KILLED (5) | a folder in front of the owner folder is refused |
| M07 | end anchor removed | KILLED (11) | a nested folder under the owner folder is refused |
| M08 | backslash allowed in the name | KILLED (4) | a backslash inside the name is refused |
| M09 | null refused (coalesce to false) | KILLED (file aborts: the seed insert of a null path is refused) | error in setup, before the numbered tests |
| M10 | name limit 128 -> 255 | KILLED (2) | a 129-character file name is refused |
| M11 | owner compared case-insensitively | KILLED (2) | the owner id must be written exactly as the database prints it |
| M12 | name may start with a dot | KILLED (2) | a name starting with a dot is refused |
| M13 | constraint dropped | KILLED (42) | the owner-path check exists ... |
| M14 | empty name allowed | KILLED (3) | an empty file name is refused |

14 mutants, 14 killed, 0 survived. Note: simply deleting the `is null` branch is an equivalent mutant (SQL treats a null check result as passing), so M09 uses coalesce instead; it is killed by the file aborting in setup rather than by a numbered test, and the numbered null-accepted tests (4, 5-style inserts with a null side) cover the same behaviour once setup passes.
