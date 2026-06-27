-- ============================================================================
-- JET OS — Fase 2 / Onda B (escopo seguro: só coleções Firestore-only com dados)
-- Dados reais a migrar: solicitacoes_prestadores (35), turnos_logistica (41),
-- pagamentos_config (1). Demais coleções da onda estão VAZIAS no Firestore.
-- NÃO toca em tabelas vivas (slots/escala/ocorrencias dual-run).
-- ============================================================================

-- ── solicitacoes_prestadores: firebase_id + campos que faltavam (evita perda) ──
alter table public.solicitacoes_prestadores add column if not exists firebase_id text;
alter table public.solicitacoes_prestadores add column if not exists uid text;             -- firebase uid do solicitante
alter table public.solicitacoes_prestadores add column if not exists pix_chave text;
alter table public.solicitacoes_prestadores add column if not exists pix_tipo text;
alter table public.solicitacoes_prestadores add column if not exists telegram text;
alter table public.solicitacoes_prestadores add column if not exists motivo_cadastro text;
alter table public.solicitacoes_prestadores add column if not exists tipo_contrato text;
alter table public.solicitacoes_prestadores add column if not exists pais text default 'BR';
alter table public.solicitacoes_prestadores add column if not exists respondido_por text;
alter table public.solicitacoes_prestadores add column if not exists data_resposta timestamptz;
create unique index if not exists uq_solic_prest_firebase_id
  on public.solicitacoes_prestadores(firebase_id) where firebase_id is not null;

-- ── turnos_logistica: tabela nova (registro de foto de início/fim de turno) ───
create table if not exists public.turnos_logistica (
  id uuid primary key default gen_random_uuid(),
  firebase_id text,
  firebase_uid text,            -- uid Firebase do worker (mapeável depois p/ usuarios.id)
  nome text,
  foto_url text,
  acao text,                    -- 'inicio' | 'fim'
  cidade text,
  criado_em timestamptz not null default now()
);
create unique index if not exists uq_turnos_log_firebase_id
  on public.turnos_logistica(firebase_id) where firebase_id is not null;
create index if not exists idx_turnos_log_uid on public.turnos_logistica(firebase_uid);
alter table public.turnos_logistica enable row level security;
create policy turnoslog_sel on public.turnos_logistica for select using (auth.uid() is not null);
create policy turnoslog_ins on public.turnos_logistica for insert with check (auth.uid() is not null);
create policy turnoslog_mod on public.turnos_logistica for update using (public.is_gestor());
create policy turnoslog_del on public.turnos_logistica for delete using (public.is_gestor());

-- pagamentos_config já existe com PK=cidade (backfill faz upsert on cidade; sem firebase_id).
