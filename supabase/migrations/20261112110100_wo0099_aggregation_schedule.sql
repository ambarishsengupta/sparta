-- WO-0099 (R7a) migration 2: the nightly aggregation run, daily at 20:30 UTC (02:00 IST) as LLD 5.1 and 12.1 say. Created only if the job is missing
-- (like the receipt purge, only where pg_cron exists: the local stack). No hosted scheduling is added.
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if not exists (select 1 from cron.job where jobname = 'sparta-run-aggregation') then
      perform cron.schedule('sparta-run-aggregation', '30 20 * * *', 'select analytics.run_aggregation()');
    end if;
  end if;
end $$;
