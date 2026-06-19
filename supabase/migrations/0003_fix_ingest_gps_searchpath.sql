-- ============================================================================
-- JET OS — Migration 0003 — Fix: search_path do RPC ingest_gps (PostGIS)
-- No Supabase o PostGIS vive no schema "extensions". A função precisa tê-lo no
-- search_path para resolver o tipo geography e as funções ST_*.
-- ============================================================================

create or replace function public.ingest_gps(p_uid uuid, p_points jsonb)
returns int
language plpgsql
set search_path = public, extensions          -- <- correção: PostGIS está em "extensions"
as $$
declare
  p     jsonb;
  ultimo jsonb;
  n int := 0;
begin
  for p in select value from jsonb_array_elements(p_points) loop
    if (p->>'lat') is null or (p->>'lng') is null then
      continue;
    end if;

    insert into public.gps_locations
      (uid, slot_id, geo, accuracy, speed, heading, altitude, bateria, is_mock, estrategia, captured_at)
    values (
      p_uid,
      nullif(p->>'slotId','')::uuid,
      ST_SetSRID(ST_MakePoint((p->>'lng')::float8, (p->>'lat')::float8), 4326)::geography,
      (p->>'accuracy')::float8,
      (p->>'speed')::float8,
      (p->>'heading')::float8,
      (p->>'altitude')::float8,
      (p->>'bateria')::int,
      coalesce((p->>'isMock')::boolean, false),
      coalesce(nullif(p->>'estrategia',''), 'background_android_native'),
      coalesce((p->>'capturedAt')::timestamptz, now())
    );

    insert into public.gps_history (uid, geo, accuracy, captured_at)
    values (
      p_uid,
      ST_SetSRID(ST_MakePoint((p->>'lng')::float8, (p->>'lat')::float8), 4326)::geography,
      (p->>'accuracy')::float8,
      coalesce((p->>'capturedAt')::timestamptz, now())
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
  end if;

  return n;
end;
$$;

revoke all on function public.ingest_gps(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_gps(uuid, jsonb) to service_role;
