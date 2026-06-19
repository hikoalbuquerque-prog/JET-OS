-- ============================================================================
-- JET OS — Escala Fase 2 (guardrails) + Fase 3 (sugeridos)
--   • Idempotência: 1 slot por (cidade, data, turno, função) → upsert sem duplicar.
--   • Teto de vagas por geração (escala_config.teto_vagas).
--   • Auditoria de geração/override (escala_audit).
--   • slots_escala.sugeridos: prestadores sugeridos (Fase 3, por confiabilidade).
-- ============================================================================
alter table public.slots_escala add column if not exists sugeridos jsonb;
create unique index if not exists uq_slotsesc_natural
  on public.slots_escala (cidade, data_slot, turno, tipo);

alter table public.escala_config add column if not exists teto_vagas int default 10;

create table if not exists public.escala_audit (
  id uuid primary key default gen_random_uuid(),
  evento text not null, detalhe jsonb, por uuid, cidade text,
  criado_em timestamptz not null default now()
);
alter table public.escala_audit enable row level security;
create policy escaudit_sel on public.escala_audit for select using (public.is_gestor());
create policy escaudit_ins on public.escala_audit for insert with check (auth.uid() is not null);

-- Métricas de previsibilidade (próximos 7 dias) — para o painel.
create or replace function public.analytics_escala(p_cidade text default null)
returns jsonb language sql stable security invoker set search_path = public as $$
  with s as (
    select * from public.slots_escala
    where data_slot >= current_date and data_slot < current_date + 8
      and (p_cidade is null or cidade = p_cidade)
  )
  select jsonb_build_object(
    'slots',        (select count(*) from s),
    'vagas',        (select coalesce(sum(qtd_pessoas),0) from s),
    'por_dia',      (select coalesce(jsonb_object_agg(data_slot, n),'{}') from (select data_slot, count(*) n from s group by data_slot) d),
    'por_funcao',   (select coalesce(jsonb_object_agg(tipo, n),'{}') from (select tipo, count(*) n from s group by tipo) f),
    'gerado_auto',  (select count(*) from s where gerado_auto)
  );
$$;
grant execute on function public.analytics_escala(text) to authenticated, anon;
