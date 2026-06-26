-- ============================================================================
-- JET OS — Fase 2 / Onda A: firebase_id para backfill idempotente + dual-write
-- Mapeia o id do doc Firestore → linha Supabase, permitindo:
--   • backfill re-rodável (upsert on conflict firebase_id)
--   • dual-write durante a transição (achar a linha pelo id Firestore)
-- Tabelas: estacoes, zonas (poligonos), locais_operacionais, contratos_locais,
--          pagamentos_locais.
-- Seguro: adiciona coluna nullable + índice único parcial. Não altera dados.
-- ============================================================================

alter table public.estacoes            add column if not exists firebase_id text;
alter table public.zonas               add column if not exists firebase_id text;
alter table public.locais_operacionais add column if not exists firebase_id text;
alter table public.contratos_locais    add column if not exists firebase_id text;
alter table public.pagamentos_locais   add column if not exists firebase_id text;

-- Índice único parcial (ignora linhas legadas sem firebase_id, ex.: criadas direto no Supabase)
create unique index if not exists uq_estacoes_firebase_id
  on public.estacoes(firebase_id) where firebase_id is not null;
create unique index if not exists uq_zonas_firebase_id
  on public.zonas(firebase_id) where firebase_id is not null;
create unique index if not exists uq_locais_oper_firebase_id
  on public.locais_operacionais(firebase_id) where firebase_id is not null;
create unique index if not exists uq_contratos_locais_firebase_id
  on public.contratos_locais(firebase_id) where firebase_id is not null;
create unique index if not exists uq_pagamentos_locais_firebase_id
  on public.pagamentos_locais(firebase_id) where firebase_id is not null;
