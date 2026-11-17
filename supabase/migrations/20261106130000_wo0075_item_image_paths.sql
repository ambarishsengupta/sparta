-- WO-0075 (R5b): the picture paths of an item must belong to the item's owner (R5b checker MINOR-1).
--
-- app.items.image_path and image_thumb_path accepted any text, so user B could store a path inside user A's storage folder. That was harmless
-- while only the owner's own session read those columns, but a server route that signs URLs with the secret key trusts them. Now, when either
-- column is not null, it must be one plain file name directly under the row's own owner folder, the same shape app.job_input_ok demands of a
-- job's input: `{user_id}/{name}`, name starting with a letter or digit, then letters, digits, dot, underscore or hyphen, 128 characters at
-- most. On top of job_input_ok, two consecutive dots are refused anywhere in the name (no `..`). A slash, a backslash, a leading slash, a
-- foreign folder, an empty name and a trailing newline all fail the pattern. null stays allowed (an item without a picture).
--
-- A CHECK constraint, not a trigger, so it holds for every role (including service_role and the table owner) on insert and on every update
-- of either column or of user_id. Existing rows: ADD CONSTRAINT checks them and the migration fails loudly if one is not compliant. Today the
-- columns are written only by the photo flow (items.create with the worker's `{user_id}/{job id}-cutout.webp` style names) and the local
-- database is rebuilt from migrations, so no row is expected to fail; the evidence note records the check made on the local stack.

alter table app.items add constraint items_image_path_owner_chk check (
  (image_path is null
   or (image_path ~ ('^' || user_id::text || '/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$') and image_path !~ '\.\.'))
  and
  (image_thumb_path is null
   or (image_thumb_path ~ ('^' || user_id::text || '/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$') and image_thumb_path !~ '\.\.'))
);

comment on constraint items_image_path_owner_chk on app.items is
  'WO-0075: image_path and image_thumb_path, when set, are {user_id}/{one plain file name} (no slash, backslash or ..), as app.job_input_ok demands of job paths.';
