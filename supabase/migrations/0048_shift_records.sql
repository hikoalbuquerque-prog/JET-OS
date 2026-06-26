-- ============================================================================
-- 0048 — shift_records: registro de turno expandido (V2) — substitui `turnos`
-- Ações: inicio/intervalo/retorno/fim com foto, GPS, função, zonas, turno T0/T1/T2
-- RPC current_shift_status() retorna estado atual do turno do usuário
-- ============================================================================

create table if not exists public.shift_records (
  id              bigint generated always as identity primary key,
  user_id         uuid not null references auth.users(id) on delete cascade,
  cpf             text,
  nome            text not null,
  action          text not null check (action in ('inicio','intervalo','retorno','fim')),
  funcao          text not null,
  zonas           text[] not null default '{}',
  turno           text not null check (turno in ('T0','T1','T2')),
  lat             double precision,
  lng             double precision,
  accuracy        double precision,
  inside_zone     boolean,
  photo_path      text,
  meta            jsonb not null default '{}'::jsonb,
  registered_at   timestamptz not null default now()
);

create index if not exists idx_shiftrec_user on public.shift_records(user_id, registered_at desc);
create index if not exists idx_shiftrec_at   on public.shift_records(registered_at desc);

alter table public.shift_records enable row level security;

create policy shiftrec_sel_own on public.shift_records
  for select to authenticated using (user_id = auth.uid());
create policy shiftrec_sel_gestor on public.shift_records
  for select to authenticated using (public.is_gestor());
create policy shiftrec_ins_own on public.shift_records
  for insert to authenticated with check (user_id = auth.uid());

-- ── RPC: current_shift_status ───────────────────────────────────────────────

create or replace function public.current_shift_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  last_rec public.shift_records;
  is_open boolean := false;
begin
  select * into last_rec
  from public.shift_records
  where user_id = auth.uid()
    and registered_at >= date_trunc('day', now() at time zone 'America/Sao_Paulo')
  order by registered_at desc
  limit 1;

  if not found then
    return jsonb_build_object('open', false, 'last_action', null);
  end if;

  is_open := last_rec.action in ('inicio','retorno');
  return jsonb_build_object(
    'open', is_open,
    'last_action', last_rec.action,
    'last_at', last_rec.registered_at,
    'funcao', last_rec.funcao,
    'turno', last_rec.turno,
    'zonas', last_rec.zonas
  );
end;
$$;

grant execute on function public.current_shift_status() to authenticated;
