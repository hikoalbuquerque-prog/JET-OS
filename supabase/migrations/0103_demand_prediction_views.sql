-- O5: Demand prediction — moving average by day_of_week × hour × parking
CREATE OR REPLACE VIEW v_demanda_por_hora AS
SELECT
  cidade_id AS city_id,
  parking_id,
  EXTRACT(DOW FROM hora)::int AS dia_semana,
  EXTRACT(HOUR FROM hora)::int AS hora_dia,
  ROUND(AVG(bikes_count), 1) AS avg_bikes,
  ROUND(STDDEV_POP(bikes_count), 1) AS stddev_bikes,
  COUNT(*)::int AS amostras
FROM parking_history
WHERE hora >= NOW() - INTERVAL '28 days'
GROUP BY cidade_id, parking_id, dia_semana, hora_dia;

-- O4: Parkings that frequently drop to zero (drain rate)
CREATE OR REPLACE VIEW v_parkings_drain AS
SELECT
  cidade_id AS city_id,
  parking_id,
  COUNT(*) FILTER (WHERE bikes_count = 0)::int AS vezes_zerado_28d,
  COUNT(*)::int AS total_amostras,
  ROUND(
    COUNT(*) FILTER (WHERE bikes_count = 0)::numeric / NULLIF(COUNT(*), 0) * 100, 1
  ) AS pct_zerado,
  ROUND(AVG(bikes_count), 1) AS avg_bikes
FROM parking_history
WHERE hora >= NOW() - INTERVAL '28 days'
GROUP BY cidade_id, parking_id
HAVING COUNT(*) FILTER (WHERE bikes_count = 0) > 5;

-- O4: Flow detection — parkings that lose bikes in sequence
CREATE OR REPLACE VIEW v_fluxo_pontos AS
WITH deltas AS (
  SELECT
    cidade_id AS city_id,
    parking_id,
    hora,
    bikes_count,
    bikes_count - LAG(bikes_count) OVER (
      PARTITION BY cidade_id, parking_id ORDER BY hora
    ) AS delta
  FROM parking_history
  WHERE hora >= NOW() - INTERVAL '7 days'
)
SELECT
  city_id,
  parking_id,
  COUNT(*) FILTER (WHERE delta < -2)::int AS drops_significativos,
  COUNT(*) FILTER (WHERE delta > 2)::int AS gains_significativos,
  ROUND(AVG(CASE WHEN delta < 0 THEN delta END), 1) AS avg_perda,
  ROUND(AVG(CASE WHEN delta > 0 THEN delta END), 1) AS avg_ganho
FROM deltas
WHERE delta IS NOT NULL
GROUP BY city_id, parking_id
HAVING COUNT(*) FILTER (WHERE delta < -2) > 3;
