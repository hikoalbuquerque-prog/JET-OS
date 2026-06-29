-- T5: Capacity planning views

-- Scout productivity per city (last 4 weeks)
CREATE OR REPLACE VIEW v_produtividade_scout AS
SELECT
  t.cidade,
  t.assignee_uid,
  u.nome AS scout_nome,
  COUNT(*)::int AS tarefas_concluidas,
  ROUND(AVG(
    EXTRACT(EPOCH FROM (t.concluido_em - t.criado_em)) / 60
  )::numeric, 1) AS avg_minutos_tarefa,
  COUNT(DISTINCT DATE(t.concluido_em))::int AS dias_ativos,
  ROUND(COUNT(*)::numeric / NULLIF(COUNT(DISTINCT DATE(t.concluido_em)), 0), 1) AS tarefas_por_dia
FROM tarefas_logistica t
LEFT JOIN usuarios u ON u.id = t.assignee_uid
WHERE t.status = 'concluida'
  AND t.concluido_em >= NOW() - INTERVAL '28 days'
  AND t.assignee_uid IS NOT NULL
GROUP BY t.cidade, t.assignee_uid, u.nome;

-- Fleet utilization per city
CREATE OR REPLACE VIEW v_fleet_utilization AS
SELECT
  cidade_id AS city_id,
  COUNT(DISTINCT parking_id)::int AS total_parkings,
  ROUND(AVG(bikes_count), 1) AS avg_bikes_per_parking,
  ROUND(AVG(CASE WHEN bikes_count = 0 THEN 1 ELSE 0 END) * 100, 1) AS pct_vazio_medio,
  ROUND(AVG(starts + finishes), 1) AS avg_movimentacoes_por_bucket,
  COUNT(DISTINCT DATE(hora))::int AS dias_dados
FROM parking_history
WHERE hora >= NOW() - INTERVAL '28 days'
GROUP BY cidade_id;

-- Capacity recommendation: how many scouts needed per city per shift
CREATE OR REPLACE VIEW v_capacidade_recomendada AS
WITH task_volume AS (
  SELECT
    cidade,
    EXTRACT(HOUR FROM criado_em)::int AS hora,
    CASE
      WHEN EXTRACT(HOUR FROM criado_em) BETWEEN 7 AND 14 THEN 'T1'
      WHEN EXTRACT(HOUR FROM criado_em) BETWEEN 15 AND 22 THEN 'T2'
      ELSE 'T0'
    END AS turno,
    COUNT(*)::numeric AS tarefas,
    COUNT(DISTINCT DATE(criado_em))::numeric AS dias
  FROM tarefas_logistica
  WHERE criado_em >= NOW() - INTERVAL '28 days'
  GROUP BY cidade, hora, turno
)
SELECT
  cidade,
  turno,
  ROUND(SUM(tarefas) / NULLIF(MAX(dias), 0), 1) AS tarefas_dia_medio,
  -- Assuming 8 tasks/scout/shift (based on 8h shift, 1h avg per task)
  CEIL(SUM(tarefas) / NULLIF(MAX(dias), 0) / 8) AS scouts_recomendados
FROM task_volume
GROUP BY cidade, turno;
