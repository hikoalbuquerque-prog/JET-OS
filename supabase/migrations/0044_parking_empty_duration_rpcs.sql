-- ============================================================================
-- 0044 — RPCs para duração de pontos vazios + resumo operacional da frota
-- parking_last_had_bikes: último bucket com bikes > 0 por parking
-- parkings_empty_summary: lista de parkings vazios com duração em minutos
-- fleet_operational_summary: contagem operacional excluindo oficina/apreendidos
-- ============================================================================

-- Último registro com bikes > 0 por parking (para calcular "há quanto tempo está vazio")
CREATE OR REPLACE FUNCTION public.parking_last_had_bikes(p_city_id text)
RETURNS TABLE(parking_id text, nome text, last_had_bikes_at timestamptz)
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $function$
  SELECT
    ph.parking_id,
    p.nome,
    max(ph.bucket_ts) AS last_had_bikes_at
  FROM parking_history ph
  JOIN parkings p ON p.id = ph.parking_id AND p.city_id = ph.city_id
  WHERE ph.city_id = p_city_id
    AND ph.bikes_disponiveis > 0
  GROUP BY ph.parking_id, p.nome;
$function$;

-- Parkings atualmente vazios com duração (em minutos) desde o último bucket com bikes
CREATE OR REPLACE FUNCTION public.parkings_empty_summary(p_city_id text)
RETURNS TABLE(parking_id text, nome text, is_monitor boolean, empty_since timestamptz, empty_minutes integer)
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $function$
  WITH current_empty AS (
    SELECT id, nome, coalesce((dados->>'monitor')::boolean, false) AS is_monitor
    FROM parkings
    WHERE city_id = p_city_id AND bikes_disponiveis = 0
  ),
  last_with_bikes AS (
    SELECT
      ph.parking_id,
      max(ph.bucket_ts) AS last_ts
    FROM parking_history ph
    WHERE ph.city_id = p_city_id AND ph.bikes_disponiveis > 0
    GROUP BY ph.parking_id
  )
  SELECT
    ce.id AS parking_id,
    ce.nome,
    ce.is_monitor,
    lwb.last_ts AS empty_since,
    EXTRACT(EPOCH FROM (now() - coalesce(lwb.last_ts, now() - interval '24 hours')))::integer / 60 AS empty_minutes
  FROM current_empty ce
  LEFT JOIN last_with_bikes lwb ON lwb.parking_id = ce.id
  ORDER BY empty_minutes DESC;
$function$;

-- Resumo operacional: total, operacional (sem oficina/apreendidos), ociosas >48h
CREATE OR REPLACE FUNCTION public.fleet_operational_summary(p_city_id text)
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'total',       count(*),
    'operational', count(*) FILTER (WHERE status NOT IN ('oficina','apreendidos')),
    'available',   count(*) FILTER (WHERE status = 'available'),
    'renting',     count(*) FILTER (WHERE status = 'renting'),
    'reserved',    count(*) FILTER (WHERE status = 'reserved'),
    'maintenance', count(*) FILTER (WHERE status = 'maintenance'),
    'low_battery', count(*) FILTER (WHERE status = 'low_battery'),
    'oficina',     count(*) FILTER (WHERE status = 'oficina'),
    'apreendidos', count(*) FILTER (WHERE status = 'apreendidos'),
    'idle_48h',    count(*) FILTER (
      WHERE status NOT IN ('oficina','apreendidos','renting')
        AND (last_order_at IS NULL OR last_order_at < now() - interval '48 hours')
    )
  )
  FROM bikes
  WHERE city_id = p_city_id;
$function$;
