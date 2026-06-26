-- 0037 — Fix cron jobs (substituir current_setting por URLs reais) +
-- DB triggers para substituir Firestore onDocumentCreated/onDocumentWritten.

-- ══════════════════════════════════════════════════════════════════
-- PART 1: Recriar cron jobs com URLs hardcoded
-- (os da 0036 usavam current_setting que não está definido)
-- ══════════════════════════════════════════════════════════════════

-- Remove os crons da 0036 que usavam current_setting
select cron.unschedule('limpeza-snapshots-diario');
select cron.unschedule('automacao-gerar-slots');
select cron.unschedule('automacao-gojet-15min');
select cron.unschedule('tarefas-agendado-1h');
select cron.unschedule('slots-inteligente-15min');
select cron.unschedule('escalar-sla-5min');
select cron.unschedule('gps-alertas-5min');
select cron.unschedule('historico-parking-diario');
select cron.unschedule('relatorio-guard-diario');
select cron.unschedule('relatorio-guard-semanal');
select cron.unschedule('relatorio-perdas-diario');
select cron.unschedule('relatorio-perdas-semanal');
select cron.unschedule('slots-resumo-manha');
select cron.unschedule('slots-resumo-noite');
select cron.unschedule('slots-cascata-15min');

-- Recriar com URLs reais
select cron.schedule('limpeza-snapshots-diario', '0 3 * * *', $$
  select net.http_post(
    url := 'https://ducdbrupxpzqcblfreqn.supabase.co/functions/v1/automacao',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1Y2RicnVweHB6cWNibGZyZXFuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTQ3NDk3MiwiZXhwIjoyMDk3MDUwOTcyfQ.oPTO4DXifwCUx_HYc0KHbynxyRTIqPBeK_9nKrK5hc4'),
    body := '{"action":"limpeza-snapshots"}'::jsonb);
$$);

select cron.schedule('automacao-gerar-slots', '0 21 * * *', $$
  select net.http_post(
    url := 'https://ducdbrupxpzqcblfreqn.supabase.co/functions/v1/automacao',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1Y2RicnVweHB6cWNibGZyZXFuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTQ3NDk3MiwiZXhwIjoyMDk3MDUwOTcyfQ.oPTO4DXifwCUx_HYc0KHbynxyRTIqPBeK_9nKrK5hc4'),
    body := '{"action":"gerar-slots"}'::jsonb);
$$);

select cron.schedule('automacao-gojet-15min', '*/15 * * * *', $$
  select net.http_post(
    url := 'https://ducdbrupxpzqcblfreqn.supabase.co/functions/v1/automacao-gojet',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1Y2RicnVweHB6cWNibGZyZXFuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTQ3NDk3MiwiZXhwIjoyMDk3MDUwOTcyfQ.oPTO4DXifwCUx_HYc0KHbynxyRTIqPBeK_9nKrK5hc4'),
    body := '{"action":"scraper"}'::jsonb);
$$);

select cron.schedule('tarefas-agendado-1h', '0 * * * *', $$
  select net.http_post(
    url := 'https://ducdbrupxpzqcblfreqn.supabase.co/functions/v1/automacao-tarefas',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1Y2RicnVweHB6cWNibGZyZXFuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTQ3NDk3MiwiZXhwIjoyMDk3MDUwOTcyfQ.oPTO4DXifwCUx_HYc0KHbynxyRTIqPBeK_9nKrK5hc4'),
    body := '{"action":"gerar-tarefas-agendado"}'::jsonb);
$$);

select cron.schedule('slots-inteligente-15min', '*/15 * * * *', $$
  select net.http_post(
    url := 'https://ducdbrupxpzqcblfreqn.supabase.co/functions/v1/automacao-tarefas',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1Y2RicnVweHB6cWNibGZyZXFuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTQ3NDk3MiwiZXhwIjoyMDk3MDUwOTcyfQ.oPTO4DXifwCUx_HYc0KHbynxyRTIqPBeK_9nKrK5hc4'),
    body := '{"action":"gerar-slots-inteligente"}'::jsonb);
$$);

select cron.schedule('escalar-sla-5min', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://ducdbrupxpzqcblfreqn.supabase.co/functions/v1/automacao-tarefas',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1Y2RicnVweHB6cWNibGZyZXFuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTQ3NDk3MiwiZXhwIjoyMDk3MDUwOTcyfQ.oPTO4DXifwCUx_HYc0KHbynxyRTIqPBeK_9nKrK5hc4'),
    body := '{"action":"escalar-slots-sla"}'::jsonb);
$$);

select cron.schedule('gps-alertas-5min', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://ducdbrupxpzqcblfreqn.supabase.co/functions/v1/gps-alertas',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1Y2RicnVweHB6cWNibGZyZXFuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTQ3NDk3MiwiZXhwIjoyMDk3MDUwOTcyfQ.oPTO4DXifwCUx_HYc0KHbynxyRTIqPBeK_9nKrK5hc4'),
    body := '{"action":"verificar-atrasos"}'::jsonb);
$$);

select cron.schedule('historico-parking-diario', '55 23 * * *', $$
  select net.http_post(
    url := 'https://ducdbrupxpzqcblfreqn.supabase.co/functions/v1/automacao-tarefas',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1Y2RicnVweHB6cWNibGZyZXFuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTQ3NDk3MiwiZXhwIjoyMDk3MDUwOTcyfQ.oPTO4DXifwCUx_HYc0KHbynxyRTIqPBeK_9nKrK5hc4'),
    body := '{"action":"salvar-historico-parking"}'::jsonb);
$$);

select cron.schedule('relatorio-guard-diario', '0 7 * * 2-7', $$
  select net.http_post(
    url := 'https://ducdbrupxpzqcblfreqn.supabase.co/functions/v1/relatorios',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1Y2RicnVweHB6cWNibGZyZXFuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTQ3NDk3MiwiZXhwIjoyMDk3MDUwOTcyfQ.oPTO4DXifwCUx_HYc0KHbynxyRTIqPBeK_9nKrK5hc4'),
    body := '{"action":"guard-diario"}'::jsonb);
$$);

select cron.schedule('relatorio-guard-semanal', '0 7 * * 1', $$
  select net.http_post(
    url := 'https://ducdbrupxpzqcblfreqn.supabase.co/functions/v1/relatorios',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1Y2RicnVweHB6cWNibGZyZXFuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTQ3NDk3MiwiZXhwIjoyMDk3MDUwOTcyfQ.oPTO4DXifwCUx_HYc0KHbynxyRTIqPBeK_9nKrK5hc4'),
    body := '{"action":"guard-semanal"}'::jsonb);
$$);

select cron.schedule('relatorio-perdas-diario', '0 8 * * *', $$
  select net.http_post(
    url := 'https://ducdbrupxpzqcblfreqn.supabase.co/functions/v1/relatorios',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1Y2RicnVweHB6cWNibGZyZXFuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTQ3NDk3MiwiZXhwIjoyMDk3MDUwOTcyfQ.oPTO4DXifwCUx_HYc0KHbynxyRTIqPBeK_9nKrK5hc4'),
    body := '{"action":"perdas-diario"}'::jsonb);
$$);

select cron.schedule('relatorio-perdas-semanal', '0 8 * * 1', $$
  select net.http_post(
    url := 'https://ducdbrupxpzqcblfreqn.supabase.co/functions/v1/relatorios',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1Y2RicnVweHB6cWNibGZyZXFuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTQ3NDk3MiwiZXhwIjoyMDk3MDUwOTcyfQ.oPTO4DXifwCUx_HYc0KHbynxyRTIqPBeK_9nKrK5hc4'),
    body := '{"action":"perdas-semanal"}'::jsonb);
$$);

select cron.schedule('slots-resumo-manha', '0 8 * * *', $$
  select net.http_post(
    url := 'https://ducdbrupxpzqcblfreqn.supabase.co/functions/v1/slots-telegram',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1Y2RicnVweHB6cWNibGZyZXFuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTQ3NDk3MiwiZXhwIjoyMDk3MDUwOTcyfQ.oPTO4DXifwCUx_HYc0KHbynxyRTIqPBeK_9nKrK5hc4'),
    body := '{"action":"resumo"}'::jsonb);
$$);

select cron.schedule('slots-resumo-noite', '0 20 * * *', $$
  select net.http_post(
    url := 'https://ducdbrupxpzqcblfreqn.supabase.co/functions/v1/slots-telegram',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1Y2RicnVweHB6cWNibGZyZXFuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTQ3NDk3MiwiZXhwIjoyMDk3MDUwOTcyfQ.oPTO4DXifwCUx_HYc0KHbynxyRTIqPBeK_9nKrK5hc4'),
    body := '{"action":"resumo"}'::jsonb);
$$);

select cron.schedule('slots-cascata-15min', '*/15 * * * *', $$
  select net.http_post(
    url := 'https://ducdbrupxpzqcblfreqn.supabase.co/functions/v1/slots-telegram',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1Y2RicnVweHB6cWNibGZyZXFuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTQ3NDk3MiwiZXhwIjoyMDk3MDUwOTcyfQ.oPTO4DXifwCUx_HYc0KHbynxyRTIqPBeK_9nKrK5hc4'),
    body := '{"action":"confirmar-cascata"}'::jsonb);
$$);


-- ══════════════════════════════════════════════════════════════════
-- PART 2: DB triggers (substituem Firestore onDocumentCreated)
-- Usam pg_net p/ chamar Edge Functions quando dados mudam.
-- ══════════════════════════════════════════════════════════════════

-- Tabela auxiliar p/ tracking de prestadores em slots (update-position)
create table if not exists public.slots_prestadores (
  id          bigint generated by default as identity primary key,
  slot_id     text not null,
  uid         text not null,
  lat         double precision,
  lng         double precision,
  dentro_da_zona boolean default false,
  mudou_estado_em timestamptz,
  atualizado_em   timestamptz not null default now(),
  unique(slot_id, uid)
);
alter table public.slots_prestadores enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='slots_prestadores' and policyname='sp_sel') then
    create policy sp_sel on public.slots_prestadores for select using (auth.role() = 'authenticated');
  end if;
  if not exists (select 1 from pg_policies where tablename='slots_prestadores' and policyname='sp_all') then
    create policy sp_all on public.slots_prestadores for all using (true);
  end if;
end $$;

-- Trigger: novo GPS → verificar chegada a ponto
create or replace function public.fn_gps_chegada_trigger()
returns trigger language plpgsql security definer as $$
begin
  perform net.http_post(
    url := 'https://ducdbrupxpzqcblfreqn.supabase.co/functions/v1/gps-alertas',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1Y2RicnVweHB6cWNibGZyZXFuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTQ3NDk3MiwiZXhwIjoyMDk3MDUwOTcyfQ.oPTO4DXifwCUx_HYc0KHbynxyRTIqPBeK_9nKrK5hc4'),
    body := jsonb_build_object(
      'action','verificar-chegada',
      'uid', NEW.user_id,
      'lat', ST_Y(NEW.geo::geometry),
      'lng', ST_X(NEW.geo::geometry),
      'timestamp', NEW.captured_at
    )
  );
  return NEW;
end;
$$;

drop trigger if exists trg_gps_chegada on public.gps_locations;
create trigger trg_gps_chegada
  after insert on public.gps_locations
  for each row execute function public.fn_gps_chegada_trigger();

-- Trigger: nova solicitação → notificar gestores
create or replace function public.fn_solicitacao_notificar()
returns trigger language plpgsql security definer as $$
begin
  perform net.http_post(
    url := 'https://ducdbrupxpzqcblfreqn.supabase.co/functions/v1/notificacoes-prestador',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1Y2RicnVweHB6cWNibGZyZXFuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTQ3NDk3MiwiZXhwIjoyMDk3MDUwOTcyfQ.oPTO4DXifwCUx_HYc0KHbynxyRTIqPBeK_9nKrK5hc4'),
    body := jsonb_build_object(
      'solicitacaoId', NEW.id,
      'nome', NEW.nome,
      'cargo', coalesce(NEW.cargo, NEW.role_desejado, ''),
      'cidade', coalesce(NEW.cidade, ''),
      'email', coalesce(NEW.email, '')
    )
  );
  return NEW;
end;
$$;

drop trigger if exists trg_solicitacao_notificar on public.solicitacoes_prestadores;
create trigger trg_solicitacao_notificar
  after insert on public.solicitacoes_prestadores
  for each row execute function public.fn_solicitacao_notificar();
