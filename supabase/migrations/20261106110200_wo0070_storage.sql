-- WO-0070 (R5b) migration 3: private buckets and owner-folder storage policies (LLD 4.6, section 10).
--
-- Buckets item-images (5 MB; jpeg, png, webp), receipts (8 MB; those and pdf), exports (50 MB; zip). All private. A user reads only objects
-- whose first folder is their own user id and writes only into item-images and receipts, directly in their own folder, while they hold the
-- consent gate and store less than 8 MB (app.storage_used, counted over item-images and receipts). There is NO update and NO delete policy for
-- users: an existing object cannot be overwritten (upsert is an update), and removal is done by the server routes and by
-- app.delete_my_account() (next migration). anon has no policy at all, so it can neither list nor fetch.
--
-- Tightening beyond the LLD text, on purpose: the write policy also requires the consumer role (as every app policy does, LLD 10) and
-- that the object sits directly in the user's folder (`{user_id}/{file}`, no deeper nesting).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('item-images', 'item-images', false, 5242880,  array['image/jpeg', 'image/png', 'image/webp']),
  ('receipts',    'receipts',    false, 8388608,  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  ('exports',     'exports',     false, 52428800, array['application/zip'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- bytes the caller already stores in item-images and receipts (the 8 MB cap, LLD 4.6)
create function app.storage_used() returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce(sum((o.metadata ->> 'size')::bigint), 0)::bigint from storage.objects o
  where o.bucket_id in ('item-images', 'receipts')
    and (storage.foldername(o.name))[1] = (select auth.uid())::text $$;
revoke execute on function app.storage_used() from public, anon, authenticated;
grant execute on function app.storage_used() to authenticated;

create policy storage_own_folder_read on storage.objects for select to authenticated
  using (bucket_id in ('item-images', 'receipts', 'exports')
         and (storage.foldername(name))[1] = (select auth.uid())::text
         and (select app.has_consent()));
create policy storage_own_folder_write on storage.objects for insert to authenticated
  with check (bucket_id in ('item-images', 'receipts')
              and (storage.foldername(name))[1] = (select auth.uid())::text
              and array_length(storage.foldername(name), 1) = 1
              and (select app.current_role()) = 'consumer'
              and (select app.has_consent())
              and (select app.storage_used()) < 8388608);
