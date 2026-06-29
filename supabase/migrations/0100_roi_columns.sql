-- F5: ROI per task columns
ALTER TABLE tarefas_logistica
  ADD COLUMN IF NOT EXISTS custo_estimado    NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS receita_estimada  NUMERIC(10,2);

-- View: ROI summary per city (last 7 days)
CREATE OR REPLACE VIEW v_roi_cidade AS
SELECT
  cidade,
  COUNT(*)::int AS tarefas_total,
  COUNT(*) FILTER (WHERE status = 'concluida')::int AS tarefas_concluidas,
  COALESCE(SUM(custo_estimado), 0)::numeric(10,2) AS custo_total,
  COALESCE(SUM(receita_estimada), 0)::numeric(10,2) AS receita_total,
  CASE WHEN COALESCE(SUM(custo_estimado), 0) > 0
    THEN ROUND((COALESCE(SUM(receita_estimada), 0) / SUM(custo_estimado) - 1) * 100, 1)
    ELSE 0
  END AS roi_pct
FROM tarefas_logistica
WHERE criado_em >= NOW() - INTERVAL '7 days'
GROUP BY cidade;
