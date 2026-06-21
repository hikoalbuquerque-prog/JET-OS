-- ============================================================================
-- JET OS — Fase 2 / Onda B menores — firebase_id único NÃO-parcial
-- Os índices da 0026 eram parciais (where firebase_id is not null), o que o
-- PostgREST não aceita como alvo de on_conflict. Versão não-parcial habilita o
-- upsert dos mirrors (múltiplos NULL continuam permitidos num unique index).
-- ============================================================================

drop index if exists public.uq_solic_prest_firebase_id;
create unique index if not exists uq_solic_prest_firebase_id
  on public.solicitacoes_prestadores(firebase_id);

drop index if exists public.uq_turnos_log_firebase_id;
create unique index if not exists uq_turnos_log_firebase_id
  on public.turnos_logistica(firebase_id);
