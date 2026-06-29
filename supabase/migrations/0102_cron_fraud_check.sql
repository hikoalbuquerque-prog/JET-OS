-- O2: Daily fraud detection cron (runs at 06:00 UTC = 03:00 BRT)
SELECT cron.schedule(
  'fraud-check-daily',
  '0 6 * * *',
  $$SELECT net.http_post(
    url := current_setting('supabase_functions_endpoint') || '/fraud-check',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('supabase.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );$$
);
