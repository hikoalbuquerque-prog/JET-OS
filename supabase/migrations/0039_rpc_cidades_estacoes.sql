-- RPC que retorna cidades com contagem e centroide, sem precisar carregar todas as rows.
create or replace function public.cidades_estacoes()
returns table(cidade text, pais text, count bigint, lat double precision, lng double precision)
language sql stable security definer as $$
  select
    e.cidade,
    e.pais,
    count(*)::bigint,
    avg(ST_Y(e.geo::geometry))::double precision as lat,
    avg(ST_X(e.geo::geometry))::double precision as lng
  from public.estacoes e
  where e.cidade is not null and e.geo is not null
  group by e.cidade, e.pais
$$;
