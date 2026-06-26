-- ============================================================================
-- JET OS — Fase 2 / Onda A switch — índice único NÃO-parcial em estacoes.firebase_id
-- Necessário p/ upsert via PostgREST (?on_conflict=firebase_id) no mirror server-side.
-- (O índice parcial `where firebase_id is not null` não é inferível pelo ON CONFLICT.)
-- Em Postgres, índice único comum trata múltiplos NULL como distintos → linhas legadas
-- sem firebase_id continuam permitidas.
-- ============================================================================
drop index if exists public.uq_estacoes_firebase_id;
create unique index if not exists uq_estacoes_firebase_id on public.estacoes(firebase_id);
