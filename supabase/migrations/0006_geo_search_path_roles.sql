-- ============================================================================
-- JET OS — Migration 0006 — PostGIS no search_path das roles da API
-- Para que casts text->geography funcionem via PostgREST (mirror/backfill e leituras
-- geo do frontend na Fase 2), as roles da API precisam de "topology" no search_path
-- (neste projeto o PostGIS está lá — ver reference_supabase_postgis_topology / Seção 14.5.1).
-- Vale para conexões NOVAS (PostgREST abre sessões novas após a aplicação).
-- ============================================================================

alter role anon          set search_path = public, extensions, topology;
alter role authenticated set search_path = public, extensions, topology;
alter role service_role  set search_path = public, extensions, topology;
