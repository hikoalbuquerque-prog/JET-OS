-- ============================================================================
-- JET OS — Migration 0057 — Views de leitura GPS (Onda D)
-- PostgREST não executa ST_X/ST_Y direto. Views expõem lat/lng numéricos
-- e mapeiam uid (uuid Supabase) → firebase_uid (text) para o frontend
-- que ainda identifica usuários pelo UID do Firebase.
-- ============================================================================

-- Posições recentes (gps_locations) com lat/lng + firebase_uid
create or replace view public.gps_locations_v as
select
  gl.id,
  gl.uid,
  u.firebase_uid,
  u.nome,
  gl.slot_id,
  ST_Y(gl.geo::geometry) as lat,
  ST_X(gl.geo::geometry) as lng,
  gl.accuracy,
  gl.speed,
  gl.heading,
  gl.altitude,
  gl.bateria,
  gl.is_mock,
  gl.estrategia,
  gl.captured_at,
  gl.criado_em
from public.gps_locations gl
left join public.usuarios u on u.id = gl.uid;

-- Histórico (gps_history) com lat/lng + firebase_uid
create or replace view public.gps_history_v as
select
  gh.id,
  gh.uid,
  u.firebase_uid,
  ST_Y(gh.geo::geometry) as lat,
  ST_X(gh.geo::geometry) as lng,
  gh.accuracy,
  gh.captured_at,
  gh.criado_em
from public.gps_history gh
left join public.usuarios u on u.id = gh.uid;
