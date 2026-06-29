-- Register cron for push-pre-turno (every 5 minutes)
SELECT cron.schedule(
  'push-pre-turno',
  '*/5 * * * *',
  $$SELECT net.http_post(
    url := current_setting('supabase_functions_endpoint') || '/push-pre-turno',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('supabase.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );$$
);
