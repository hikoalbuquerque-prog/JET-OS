-- ============================================================================
-- JET OS — Fase 2 — Analytics #2: heatmap GPS + perdas por filial
--   • analytics_gps_heatmap(): pontos binados (round 4 casas ~11m) + peso=contagem,
--     a partir de gps_history. Filtro por período e (via usuarios) cidade do operador.
--   • analytics_perdas(): ocorrências por região/filial classificadas por tipo
--     (vandalismo/roubo/furto/não-encontrado/outros) + recuperados — para o PerdasSeg.
-- Depende de 0009 (regioes_filiais, norm_txt).
-- ============================================================================

-- ── Heatmap GPS (PostGIS em 'topology': search_path inclui topology) ────────
create or replace function public.analytics_gps_heatmap(
  p_desde timestamptz default null, p_cidade text default null, p_limit int default 2000
) returns table (lat double precision, lng double precision, weight bigint)
language sql stable security invoker
set search_path = public, extensions, topology
as $$
  select round(ST_Y(g.geo::geometry)::numeric, 4)::float8 as lat,
         round(ST_X(g.geo::geometry)::numeric, 4)::float8 as lng,
         count(*) as weight
  from public.gps_history g
  left join public.usuarios u on u.id = g.uid
  where (p_desde is null or g.captured_at >= p_desde)
    and (p_cidade is null or u.cidade = p_cidade)
  group by 1, 2
  order by weight desc
  limit greatest(1, coalesce(p_limit, 2000));
$$;
grant execute on function public.analytics_gps_heatmap(timestamptz, text, int) to authenticated, anon;

-- ── Perdas por região/filial (PainelControlePerdasSeg) ──────────────────────
create or replace function public.analytics_perdas(
  p_desde timestamptz default null, p_cidade text default null
) returns table (
  regiao text, filial text,
  vandalismo bigint, roubo bigint, furto bigint, nao_encontrado bigint,
  outros bigint, recuperados bigint, total bigint
)
language sql stable security invoker
set search_path = public
as $$
  select
    coalesce(rf.regiao, 'Sem região'),
    coalesce(rf.filial, coalesce(o.cidade, 'Sem cidade')),
    count(*) filter (where o.tipo ilike '%vandal%'),
    count(*) filter (where o.tipo ilike '%roubo%'),
    count(*) filter (where o.tipo ilike '%furto%'),
    count(*) filter (where o.tipo ilike '%encontr%' or o.tipo ilike '%perdid%'),
    count(*) filter (where not (
        o.tipo ilike '%vandal%' or o.tipo ilike '%roubo%' or o.tipo ilike '%furto%'
        or o.tipo ilike '%encontr%' or o.tipo ilike '%perdid%' or o.tipo ilike '%recupera%')),
    count(*) filter (where o.tipo ilike '%recupera%' or o.status ilike '%recuper%'),
    count(*)
  from public.ocorrencias o
  left join public.regioes_filiais rf on public.norm_txt(rf.cidade) = public.norm_txt(o.cidade)
  where (p_desde is null or o.criado_em >= p_desde)
    and (p_cidade is null or o.cidade = p_cidade)
  group by 1, 2
  order by 1, 2;
$$;
grant execute on function public.analytics_perdas(timestamptz, text) to authenticated, anon;
