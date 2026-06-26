-- ============================================================================
-- 0046 — bike_history: expandir tabela existente + transições de status
-- A tabela já existe com (id, city_id, bike_id, status, bucket_ts, criado_em).
-- Adiciona: lat, lng, bateria, observed_at, bucket (alias de bucket_ts p/ V2 compat).
-- Cria: unique index, RPC idle_bikes_summary, cron cleanup.
-- ============================================================================

-- Adicionar colunas faltantes
alter table public.bike_history add column if not exists lat double precision;
alter table public.bike_history add column if not exists lng double precision;
alter table public.bike_history add column if not exists bateria integer;
alter table public.bike_history add column if not exists observed_at timestamptz default now();

-- Backfill: observed_at = criado_em onde null
update public.bike_history set observed_at = criado_em where observed_at is null;
alter table public.bike_history alter column observed_at set not null;

-- Drop CHECK constraint de status se existir (pode não ter todos os valores)
do $$ begin
  alter table public.bike_history drop constraint if exists bike_history_status_check;
exception when others then null;
end $$;

-- Indexes
create unique index if not exists uq_bike_hist_bucket
  on public.bike_history(bike_id, bucket_ts);

create index if not exists idx_bike_hist_observed
  on public.bike_history(bike_id, observed_at desc);

create index if not exists idx_bike_hist_city
  on public.bike_history(city_id);

-- RLS
alter table public.bike_history enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='bike_history' and policyname='bhist_sel') then
    create policy bhist_sel on public.bike_history for select using (auth.role() = 'authenticated');
  end if;
end $$;

-- ── RPC: bikes ociosas há mais de X horas ──────────────────────────────────
create or replace function public.idle_bikes_summary(p_hours integer default 48)
returns table (
  bike_id     text,
  city_id     text,
  status      text,
  bateria     integer,
  lat         double precision,
  lng         double precision,
  last_change timestamptz,
  idle_hours  double precision
)
language sql stable
set search_path = public, extensions
as $$
  with latest as (
    select distinct on (bh.bike_id)
      bh.bike_id, bh.city_id, bh.status, bh.bateria, bh.lat, bh.lng, bh.observed_at
    from bike_history bh
    order by bh.bike_id, bh.observed_at desc
  )
  select
    l.bike_id, l.city_id, l.status, l.bateria, l.lat, l.lng,
    l.observed_at as last_change,
    extract(epoch from (now() - l.observed_at)) / 3600.0 as idle_hours
  from latest l
  where l.observed_at < now() - make_interval(hours => p_hours)
    and l.status in ('available', 'maintenance', 'low_battery')
  order by l.observed_at asc;
$$;

grant execute on function public.idle_bikes_summary(integer) to authenticated;

-- ── Cron: limpar registros >60 dias ────────────────────────────────────────
select cron.schedule('bike-history-cleanup', '0 3 * * 0', $$
  delete from public.bike_history where observed_at < now() - interval '60 days';
$$);
