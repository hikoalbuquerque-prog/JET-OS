-- ============================================================================
-- JET OS — Fase 2 / Onda A switch — views de leitura + índices p/ mirror (zonas, locais)
-- ============================================================================

-- firebase_id único NÃO-parcial (p/ upsert via PostgREST on_conflict no mirror)
drop index if exists public.uq_zonas_firebase_id;
create unique index if not exists uq_zonas_firebase_id on public.zonas(firebase_id);
drop index if exists public.uq_locais_oper_firebase_id;
create unique index if not exists uq_locais_oper_firebase_id on public.locais_operacionais(firebase_id);

-- Zonas: geom (Polygon) → GeoJSON p/ o app reconstruir os vértices [{lat,lng}]
create or replace view public.zonas_geo
  with (security_invoker = true) as
select id, firebase_id, nome, grupo, fase, cor, ativo, cidade, pais, prioridade,
       ST_AsGeoJSON(geom::geometry) as geojson,
       criado_em
from public.zonas;

-- Locais operacionais: geo (Point) → lat/lng
create or replace view public.locais_geo
  with (security_invoker = true) as
select id, firebase_id, nome, tipo, cidade, pais, obs,
       ST_Y(geo::geometry) as lat, ST_X(geo::geometry) as lng,
       criado_em
from public.locais_operacionais;
