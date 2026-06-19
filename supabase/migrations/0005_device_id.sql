-- ============================================================================
-- JET OS — Migration 0005 — Device ID (anti-compartilhamento de aparelho)
-- - device_id em cada ponto de GPS (auditoria de qual aparelho enviou)
-- - tabela dispositivos (uid x device_id) p/ detectar conta em aparelho novo
--   e aparelho usado por várias contas
-- - ingest_gps grava o device_id e faz upsert em dispositivos
-- ============================================================================

alter table public.gps_locations add column if not exists device_id text;

create table if not exists public.dispositivos (
  uid            uuid not null references public.usuarios(id) on delete cascade,
  device_id      text not null,
  modelo         text,
  primeiro_visto timestamptz not null default now(),
  ultimo_visto   timestamptz not null default now(),
  aprovado       boolean not null default false,   -- gestor aprova aparelho novo
  primary key (uid, device_id)
);
create index if not exists idx_disp_device on public.dispositivos(device_id);
alter table public.dispositivos enable row level security;
create policy disp_sel    on public.dispositivos for select using (uid = auth.uid() or public.is_gestor());
create policy disp_gestor on public.dispositivos for all    using (public.is_gestor()) with check (public.is_gestor());
-- escrita pelo ingest = service_role (bypassa RLS)

-- Aparelhos usados por 2+ contas (compartilhamento) — para o painel do gestor.
create or replace view public.dispositivos_compartilhados
with (security_invoker = true) as
  select device_id,
         count(distinct uid)        as contas,
         array_agg(distinct uid)    as uids,
         max(ultimo_visto)          as ultimo_visto
  from public.dispositivos
  group by device_id
  having count(distinct uid) > 1;

-- RPC atualizado: grava device_id por ponto + upsert em dispositivos.
create or replace function public.ingest_gps(p_uid uuid, p_points jsonb)
returns int
language plpgsql
set search_path = public, extensions, topology
as $$
declare
  p      jsonb;
  ultimo jsonb;
  n int := 0;
begin
  for p in select value from jsonb_array_elements(p_points) loop
    if (p->>'lat') is null or (p->>'lng') is null then
      continue;
    end if;

    insert into public.gps_locations
      (uid, slot_id, geo, accuracy, speed, heading, altitude, bateria, is_mock, estrategia, captured_at, device_id)
    values (
      p_uid,
      nullif(p->>'slotId','')::uuid,
      ST_SetSRID(ST_MakePoint((p->>'lng')::float8, (p->>'lat')::float8), 4326)::geography,
      (p->>'accuracy')::float8, (p->>'speed')::float8, (p->>'heading')::float8, (p->>'altitude')::float8,
      (p->>'bateria')::int, coalesce((p->>'isMock')::boolean, false),
      coalesce(nullif(p->>'estrategia',''), 'background_android_native'),
      coalesce((p->>'capturedAt')::timestamptz, now()),
      nullif(p->>'deviceId','')
    );

    insert into public.gps_history (uid, geo, accuracy, captured_at)
    values (
      p_uid,
      ST_SetSRID(ST_MakePoint((p->>'lng')::float8, (p->>'lat')::float8), 4326)::geography,
      (p->>'accuracy')::float8, coalesce((p->>'capturedAt')::timestamptz, now())
    );

    n := n + 1;
    ultimo := p;
  end loop;

  if ultimo is not null then
    update public.usuarios set
      ultima_pos        = ST_SetSRID(ST_MakePoint((ultimo->>'lng')::float8, (ultimo->>'lat')::float8), 4326)::geography,
      ultima_accuracy   = (ultimo->>'accuracy')::float8,
      ultima_velocidade = (ultimo->>'speed')::float8,
      ultima_pos_em     = now(),
      slot_atual_id     = nullif(ultimo->>'slotId','')::uuid
    where id = p_uid;

    -- registra/atualiza o aparelho (anti-compartilhamento)
    if nullif(ultimo->>'deviceId','') is not null then
      insert into public.dispositivos (uid, device_id, modelo, primeiro_visto, ultimo_visto)
      values (p_uid, ultimo->>'deviceId', nullif(ultimo->>'deviceModel',''), now(), now())
      on conflict (uid, device_id) do update
        set ultimo_visto = now(),
            modelo = coalesce(excluded.modelo, public.dispositivos.modelo);
    end if;
  end if;

  return n;
end;
$$;

revoke all on function public.ingest_gps(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_gps(uuid, jsonb) to service_role;
