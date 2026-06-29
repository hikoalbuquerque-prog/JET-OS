-- Adiciona lat/lng em cidade_config para cidades sem estações/parkings
alter table public.cidade_config
  add column if not exists lat double precision,
  add column if not exists lng double precision;

-- Popula coordenadas conhecidas
update public.cidade_config set lat = -23.5505, lng = -46.6333 where nome = 'Sao Paulo' and lat is null;
update public.cidade_config set lat = -23.6571, lng = -46.5322 where nome = 'Santo André' and lat is null;
update public.cidade_config set lat = -26.9906, lng = -48.6348 where nome = 'Balneario Camboriu' and lat is null;
update public.cidade_config set lat = -19.9167, lng = -43.9345 where nome = 'Belo Horizonte' and lat is null;
update public.cidade_config set lat = -15.7939, lng = -47.8828 where nome = 'Brasilia' and lat is null;
update public.cidade_config set lat = -25.4284, lng = -49.2733 where nome = 'Curitiba' and lat is null;
update public.cidade_config set lat = -22.9068, lng = -43.1729 where nome = 'Rio de Janeiro' and lat is null;
update public.cidade_config set lat = -30.0346, lng = -51.2177 where nome = 'Porto Alegre' and lat is null;
update public.cidade_config set lat = -3.7172, lng = -38.5433 where nome = 'Fortaleza' and lat is null;
update public.cidade_config set lat = -12.9714, lng = -38.5124 where nome = 'Salvador' and lat is null;

-- Atualiza RPC para incluir cidades com lat/lng manual (sem parkings nem estações)
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

  union all

  select
    cc2.nome as cidade,
    'BR'::text as pais,
    0::bigint as count,
    cc2.lat,
    cc2.lng
  from public.cidade_config cc2
  where cc2.ativo = true
    and cc2.lat is not null
    and cc2.lng is not null
    and cc2.nome not in (
      select e3.cidade from public.estacoes e3
      where e3.cidade is not null and e3.geo is not null
    )
    and not exists (
      select 1 from public.parkings p2
      where extensions.unaccent(lower(p2.cidade)) = extensions.unaccent(lower(cc2.nome))
        and p2.geo is not null
    )
$$;
