-- ============================================================================
-- JET OS — Migration 0004 — Fix definitivo do search_path do RPC ingest_gps
-- Neste projeto o PostGIS (tipo geography + funções ST_*) está no schema "topology".
-- Inclui também "extensions" por robustez (caso algo venha de lá).
-- ============================================================================

alter function public.ingest_gps(uuid, jsonb)
  set search_path = public, extensions, topology;
