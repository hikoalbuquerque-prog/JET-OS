-- Habilita unaccent para comparação accent-insensitive
create extension if not exists unaccent with schema extensions;

-- Expande cidades_estacoes para incluir cidades ativas em cidade_config
-- que têm parkings mas não estações (ex: cidades GoJet recém-ativadas).
create or replace function public.cidades_estacoes()
returns table(cidade text, pais text, count bigint, lat double precision, lng double precision)
language sql stable security definer
set search_path = public, extensions, topology
as $$
  select
    e.cidade,
    e.pais,
    count(*)::bigint,
    avg(ST_Y(e.geo::geometry))::double precision as lat,
    avg(ST_X(e.geo::geometry))::double precision as lng
  from public.estacoes e
  where e.cidade is not null and e.geo is not null
  group by e.cidade, e.pais

  union all

  select
    cc.nome as cidade,
    'BR'::text as pais,
    count(p.id)::bigint,
    avg(ST_Y(p.geo::geometry))::double precision as lat,
    avg(ST_X(p.geo::geometry))::double precision as lng
  from public.cidade_config cc
  join public.parkings p
    on extensions.unaccent(lower(p.cidade)) = extensions.unaccent(lower(cc.nome))
    and p.geo is not null
  where cc.ativo = true
    and cc.nome not in (
      select e2.cidade from public.estacoes e2
      where e2.cidade is not null and e2.geo is not null
    )
  group by cc.nome
$$;
