-- ============================================================================
-- JET OS — Fase 2 — Backfill operacional (slots / turnos / ocorrências)
-- Ajusta o schema idealizado (0001) para receber o backfill do Firestore:
--   • firebase_doc_id (text unique) em slots/turnos p/ idempotência (upsert).
--   • turnos: foto do ponto (início/fim) + cidade (vinha em turnos_logistica).
--   • ocorrencias: tabela nova (não existia), modelo limpo (geo geography,
--     registrado_por uuid, campos normalizados).
-- Seguro reaplicar (add column if not exists / create table if not exists).
-- ============================================================================

-- PostGIS está no schema 'topology' neste projeto: sem isto, "geography does not exist".
set search_path = public, extensions, topology;

-- ── slots: idempotência ──────────────────────────────────────────────────────
alter table public.slots add column if not exists firebase_doc_id text;
create unique index if not exists uq_slots_fbdoc on public.slots(firebase_doc_id);

-- ── turnos: idempotência + foto do ponto + cidade ───────────────────────────
alter table public.turnos add column if not exists firebase_doc_id text;
alter table public.turnos add column if not exists foto_inicio_url text;
alter table public.turnos add column if not exists foto_fim_url text;
alter table public.turnos add column if not exists cidade text;
create unique index if not exists uq_turnos_fbdoc on public.turnos(firebase_doc_id);

-- ── slot_confirmacoes: idempotência do backfill ─────────────────────────────
-- (a chave natural unique(slot_id, uid) já existe no 0001)

-- ── ocorrencias: tabela nova (incidentes de segurança/Guard) ────────────────
create table if not exists public.ocorrencias (
  id uuid primary key default gen_random_uuid(),
  firebase_doc_id text unique,
  codigo text,                       -- id humano "JET-SEC-AAAAMMDDHHMMSS-NNN"
  tipo text, prioridade text, status text default 'aberto',
  ativo_tipo text, asset_id text,
  descricao text, observacao_fechamento text,
  geo geography(Point,4326),
  cidade text, bairro text, endereco text, estacao_id text,
  bo_numero text, bo_url text,
  foto1_url text, foto2_url text,
  cargo text, origem_registro text, turno text, procurando boolean,
  registrado_por uuid references public.usuarios(id),
  registrado_por_nome text,
  telegram_enviado boolean,
  data_manual timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz
);
create index if not exists idx_ocor_status   on public.ocorrencias(status, criado_em desc);
create index if not exists idx_ocor_cidade   on public.ocorrencias(cidade);
create index if not exists idx_ocor_registr  on public.ocorrencias(registrado_por);
create index if not exists idx_ocor_geo       on public.ocorrencias using gist(geo);

alter table public.ocorrencias enable row level security;
-- leitura: gestor vê tudo; quem registrou vê o seu. Escrita: só gestor/serviço.
create policy ocor_sel on public.ocorrencias for select
  using (registrado_por = auth.uid() or public.is_gestor());
create policy ocor_gestor on public.ocorrencias for all
  using (public.is_gestor()) with check (public.is_gestor());
