-- ============================================================================
-- JET OS — Fase 2 — Analytics #1: ocorrências por região/filial (PainelRoubos)
-- Porta a agregação que hoje é feita no cliente (Firestore) para SQL no Postgres:
--   • regioes_filiais: mapa cidade -> {filial, regiao} (de guard_config/regioes).
--   • analytics_ocorrencias(): linhas por região/filial classificando ativo_tipo
--     (patinete/bicicleta/bateria/outros), total e recuperados, com filtros de
--     período/tipo/status/cidade. É o RegionalRow[] que a UI consome, pronto.
-- ============================================================================

-- ── Tabela de apoio (referência) ────────────────────────────────────────────
create table if not exists public.regioes_filiais (
  cidade text primary key,
  filial text,
  regiao text
);
alter table public.regioes_filiais enable row level security;
drop policy if exists rf_sel on public.regioes_filiais;
create policy rf_sel on public.regioes_filiais for select using (auth.uid() is not null);

insert into public.regioes_filiais (cidade, filial, regiao) values
  ('Aracaju','Sergipe (Aracaju)','Região Norte'),
  ('Belo Horizonte','Minas Gerais (BH)','Região Norte'),
  ('Belém','Pará (Belém)','Região Norte'),
  ('Brasília','Distr. Fed. (Brasília)','Região Sul'),
  ('Campinas','SP Estado (Campinas)','Região Centro'),
  ('Ciudad de México','México','Internacional'),
  ('Curitiba','Paraná (Curitiba)','Região Sul'),
  ('Florianópolis','Santa Catarina','Região Sul'),
  ('Fortaleza','Ceará (Fortaleza)','Região Norte'),
  ('Guarulhos','SP Capital','Região Centro'),
  ('Joinville','Santa Catarina','Região Sul'),
  ('Londrina','Paraná (Londrina)','Região Sul'),
  ('México','México','Internacional'),
  ('Natal','RG Norte (Natal)','Região Norte'),
  ('Porto Alegre','RG Sul (Porto Alegre)','Região Sul'),
  ('Praia Grande','SP Litoral','Região Centro'),
  ('Recife','Pernambuco (Recife)','Região Norte'),
  ('Salvador','Bahia (Salvador)','Região Norte'),
  ('Santo André','SP Capital','Região Centro'),
  ('Santos','SP Litoral','Região Centro'),
  ('São Paulo','SP Capital','Região Centro'),
  ('Vila Velha','Espírito Santo (Vila Velha)','Região Norte'),
  ('Águas Claras','Distr. Fed. (Brasília)','Região Sul')
on conflict (cidade) do update set filial = excluded.filial, regiao = excluded.regiao;

-- ── RPC de analytics (roda no Postgres; respeita RLS de ocorrencias) ────────
create or replace function public.analytics_ocorrencias(
  p_desde timestamptz default null,
  p_tipo  text default null,
  p_status text default null,
  p_cidade text default null
) returns table (
  regiao text, filial text,
  patinetes bigint, bicicletas bigint, baterias bigint, outros bigint,
  total bigint, recuperados bigint
)
language sql stable security invoker
set search_path = public
as $$
  select
    coalesce(rf.regiao, 'Sem região') as regiao,
    coalesce(rf.filial, coalesce(o.cidade, 'Sem cidade')) as filial,
    count(*) filter (where o.ativo_tipo ilike '%patinete%')                                   as patinetes,
    count(*) filter (where o.ativo_tipo ilike '%bicicleta%' or o.ativo_tipo ilike '%bike%')    as bicicletas,
    count(*) filter (where o.ativo_tipo ilike '%bateria%')                                     as baterias,
    count(*) filter (where o.ativo_tipo is null or not (
        o.ativo_tipo ilike '%patinete%' or o.ativo_tipo ilike '%bicicleta%'
        or o.ativo_tipo ilike '%bike%'  or o.ativo_tipo ilike '%bateria%'))                    as outros,
    count(*)                                                                                   as total,
    count(*) filter (where o.tipo ilike '%recupera%')                                          as recuperados
  from public.ocorrencias o
  left join public.regioes_filiais rf on rf.cidade = o.cidade
  where (p_desde  is null or o.criado_em >= p_desde)
    and (p_tipo   is null or o.tipo   = p_tipo)
    and (p_status is null or o.status = p_status)
    and (p_cidade is null or o.cidade = p_cidade)
  group by 1, 2
  order by 1, 2;
$$;

grant execute on function public.analytics_ocorrencias(timestamptz, text, text, text) to authenticated, anon;
