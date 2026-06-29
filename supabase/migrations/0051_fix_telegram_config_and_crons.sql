-- ============================================================================
-- 0051 — Fix telegram_config colunas + crons horário BRT
-- Problema: tabela telegram_config só tinha (id, bot_token), faltavam
-- guard_chat_id/thread_id e perdas_chat_id/thread_id que a Edge Function
-- relatorios/index.ts espera. Crons estavam em UTC (7h UTC = 4h BRT).
-- ============================================================================

-- Colunas faltantes
alter table public.telegram_config add column if not exists guard_chat_id text;
alter table public.telegram_config add column if not exists guard_thread_id text;
alter table public.telegram_config add column if not exists perdas_chat_id text;
alter table public.telegram_config add column if not exists perdas_thread_id text;

-- Preencher chat_id padrão (mesmo grupo Guard)
update public.telegram_config
  set guard_chat_id  = '-1003838241500',
      perdas_chat_id = '-1003838241500'
where id = 'global'
  and guard_chat_id is null;

-- Recria crons com horário BRT (UTC-3)
-- Guard diário: 7h BRT = 10h UTC (ter-dom)
select cron.unschedule('relatorio-guard-diario');
select cron.schedule('relatorio-guard-diario', '0 10 * * 2-7', $$
  select net.http_post(
    url := 'https://ducdbrupxpzqcblfreqn.supabase.co/functions/v1/relatorios',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1Y2RicnVweHB6cWNibGZyZXFuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTQ3NDk3MiwiZXhwIjoyMDk3MDUwOTcyfQ.oPTO4DXifwCUx_HYc0KHbynxyRTIqPBeK_9nKrK5hc4'),
    body := '{"action":"guard-diario"}'::jsonb);
$$);

-- Guard semanal: 7h BRT = 10h UTC (segunda)
select cron.unschedule('relatorio-guard-semanal');
select cron.schedule('relatorio-guard-semanal', '0 10 * * 1', $$
  select net.http_post(
    url := 'https://ducdbrupxpzqcblfreqn.supabase.co/functions/v1/relatorios',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1Y2RicnVweHB6cWNibGZyZXFuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTQ3NDk3MiwiZXhwIjoyMDk3MDUwOTcyfQ.oPTO4DXifwCUx_HYc0KHbynxyRTIqPBeK_9nKrK5hc4'),
    body := '{"action":"guard-semanal"}'::jsonb);
$$);

-- Perdas diário: 8h BRT = 11h UTC (todos os dias)
select cron.unschedule('relatorio-perdas-diario');
select cron.schedule('relatorio-perdas-diario', '0 11 * * *', $$
  select net.http_post(
    url := 'https://ducdbrupxpzqcblfreqn.supabase.co/functions/v1/relatorios',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1Y2RicnVweHB6cWNibGZyZXFuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTQ3NDk3MiwiZXhwIjoyMDk3MDUwOTcyfQ.oPTO4DXifwCUx_HYc0KHbynxyRTIqPBeK_9nKrK5hc4'),
    body := '{"action":"perdas-diario"}'::jsonb);
$$);

-- Perdas semanal: 8h BRT = 11h UTC (segunda)
select cron.unschedule('relatorio-perdas-semanal');
select cron.schedule('relatorio-perdas-semanal', '0 11 * * 1', $$
  select net.http_post(
    url := 'https://ducdbrupxpzqcblfreqn.supabase.co/functions/v1/relatorios',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1Y2RicnVweHB6cWNibGZyZXFuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTQ3NDk3MiwiZXhwIjoyMDk3MDUwOTcyfQ.oPTO4DXifwCUx_HYc0KHbynxyRTIqPBeK_9nKrK5hc4'),
    body := '{"action":"perdas-semanal"}'::jsonb);
$$);
