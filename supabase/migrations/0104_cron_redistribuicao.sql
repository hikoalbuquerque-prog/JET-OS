-- O4: Redistribution cron every 30 minutes
SELECT cron.schedule(
  'redistribuicao-preventiva',
  '*/30 * * * *',
  $$SELECT net.http_post(
    url := current_setting('supabase_functions_endpoint') || '/redistribuicao',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('supabase.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );$$
);
