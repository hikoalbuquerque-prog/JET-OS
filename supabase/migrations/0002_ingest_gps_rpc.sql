-- ============================================================================
-- JET OS — Migration 0002 — RPC de ingestão de GPS (Fase 1, o "portão")
-- Recebe um lote de pontos (jsonb) e grava com PostGIS em gps_locations +
-- gps_history, e atualiza a última posição em usuarios.
-- Chamada pela Edge Function ingest-gps com service_role (uid vem do JWT verificado).
-- Mesma forma de payload do gps-ingest.ts atual: { lat, lng, accuracy, speed,
-- heading, altitude, bateria, isMock, estrategia, capturedAt, slotId }.
-- ============================================================================

create or replace function public.ingest_gps(p_uid uuid, p_points jsonb)
returns int
language plpgsql
as $$
declare
  p     jsonb;
  ultimo jsonb;
  n int := 0;
begin
  for p in select value from jsonb_array_elements(p_points) loop
    -- ignora pontos sem coordenada
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

  -- última posição no perfil (mapa ao vivo via Realtime)
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

-- Apenas o service_role (Edge Function) executa o RPC; ninguém anônimo/autenticado.
revoke all on function public.ingest_gps(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_gps(uuid, jsonb) to service_role;
