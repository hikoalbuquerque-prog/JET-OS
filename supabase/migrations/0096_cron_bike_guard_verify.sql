-- F5: Crons para bike-guard (5min) e gojet-verify (5min)

-- Bike Guard: monitora bikes em trânsito + bateria crítica
select cron.schedule('bike-guard-5min', '*/5 * * * *', $$
  select net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/bike-guard',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || current_setting('app.settings.service_role_key')),
    body := '{}'::jsonb
  );
$$);

-- GoJet Verify: verifica entregas pós-conclusão (5min delay, 35min timeout)
select cron.schedule('gojet-verify-5min', '*/5 * * * *', $$
  select net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/gojet-verify',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || current_setting('app.settings.service_role_key')),
    body := '{}'::jsonb
  );
$$);
