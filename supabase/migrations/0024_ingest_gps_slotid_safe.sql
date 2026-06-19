-- ============================================================================
-- JET OS — Migration 0024 — ingest_gps: cast de slotId tolerante a uuid inválido
-- Bug: nullif(p->>'slotId','')::uuid explode se slotId não for uuid (ex.: id de slot
-- do Firebase durante a migração) → o lote INTEIRO de GPS é perdido (buracos no
-- rastreio). Aqui só convertemos se casar o padrão uuid; senão, null (ponto entra
-- sem slot). Resto idêntico ao 0002.
-- ============================================================================

create or replace function public.ingest_gps(p_uid uuid, p_points jsonb)
returns int
language plpgsql
as $$
declare
  p      jsonb;
  ultimo jsonb;
  n int := 0;
  v_slot uuid;
  v_uslot uuid;
begin
  for p in select value from jsonb_array_elements(p_points) loop
    if (p->>'lat') is null or (p->>'lng') is null then
      continue;
    end if;

    -- slotId só vira uuid se for um uuid válido; senão null (não derruba o lote)
    v_slot := case
      when (p->>'slotId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (p->>'slotId')::uuid else null end;

    insert into public.gps_locations
      (uid, slot_id, geo, accuracy, speed, heading, altitude, bateria, is_mock, estrategia, captured_at)
    values (
      p_uid,
      v_slot,
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
    v_uslot := case
      when (ultimo->>'slotId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (ultimo->>'slotId')::uuid else null end;
    update public.usuarios set
      ultima_pos        = ST_SetSRID(ST_MakePoint((ultimo->>'lng')::float8, (ultimo->>'lat')::float8), 4326)::geography,
      ultima_accuracy   = (ultimo->>'accuracy')::float8,
      ultima_velocidade = (ultimo->>'speed')::float8,
      ultima_pos_em     = now(),
      slot_atual_id     = v_uslot
    where id = p_uid;
  end if;

  return n;
end;
$$;

revoke all on function public.ingest_gps(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_gps(uuid, jsonb) to service_role;
