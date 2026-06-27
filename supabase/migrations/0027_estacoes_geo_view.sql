-- ============================================================================
-- JET OS — Fase 2 / Onda A switch — view de leitura das estações com lat/lng.
-- A coluna estacoes.geo é geography(Point); o app precisa de lat/lng numéricos.
-- security_invoker=true → respeita a RLS da tabela estacoes (não bypassa).
-- ============================================================================
create or replace view public.estacoes_geo
  with (security_invoker = true) as
select
  id,
  firebase_id,
  codigo,
  cidade,
  pais,
  bairro,
  endereco,
  tipo,
  status,
  imagens,
  ia,
  croqui_status,
  ST_Y(geo::geometry) as lat,
  ST_X(geo::geometry) as lng,
  criado_em
from public.estacoes;
