-- WO-0080 (R6a) migration 4: receipt jobs are deleted 7 days after they finish (FR-47, LLD 7.4 and 13.4: "job results 7 days").
-- The status machine forbids changing a final job, so deletion is the purge. Photo jobs, receipt jobs that are still queued or running and
-- receipt jobs that finished less than 7 days ago are untouched. Runs daily under pg_cron as the owner; nobody else can execute it.
-- Deleting a job does not touch the receipt or its purchases (receipts.job_id has no key into jobs).

create function app.purge_receipt_jobs() returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  delete from app.jobs j where j.type = 'receipt' and j.finished_at < now() - interval '7 days';
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function app.purge_receipt_jobs() from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('sparta-purge-receipt-jobs', '17 3 * * *', 'select app.purge_receipt_jobs()');
  end if;
end $$;
