-- §15.5 Guardrails — métricas de previsibilidade + transições + reabertura
-- Expande analytics_escala com % preenchimento, antecedência de aceite, reabertura

-- Colunas de controle em slots_escala
ALTER TABLE public.slots_escala ADD COLUMN IF NOT EXISTS sla_aceite_min int DEFAULT 120;
ALTER TABLE public.slots_escala ADD COLUMN IF NOT EXISTS sla_escalado_em timestamptz;
ALTER TABLE public.slots_escala ADD COLUMN IF NOT EXISTS reaberto_em timestamptz;
ALTER TABLE public.slots_escala ADD COLUMN IF NOT EXISTS override_por uuid;
ALTER TABLE public.slots_escala ADD COLUMN IF NOT EXISTS override_em timestamptz;
ALTER TABLE public.slots_escala ADD COLUMN IF NOT EXISTS override_motivo text;

-- Métricas de previsibilidade expandidas
CREATE OR REPLACE FUNCTION public.analytics_escala(p_cidade text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH s AS (
    SELECT * FROM public.slots_escala
    WHERE data_slot >= current_date AND data_slot < current_date + 8
      AND (p_cidade IS NULL OR cidade = p_cidade)
  ),
  aceites AS (
    SELECT sa.slot_id, sa.aceito_em, se.criado_em AS slot_criado_em,
           EXTRACT(EPOCH FROM (sa.aceito_em - se.criado_em))/60 AS antecedencia_min
    FROM public.slot_aceites sa
    JOIN s se ON se.id = sa.slot_id
    WHERE sa.status <> 'Desistiu'
  ),
  preenchimento AS (
    SELECT
      COUNT(*) FILTER (WHERE status = 'Preenchido') AS preenchidos,
      COUNT(*) AS total
    FROM s
  )
  SELECT jsonb_build_object(
    'slots',           (SELECT count(*) FROM s),
    'vagas',           (SELECT coalesce(sum(qtd_pessoas),0) FROM s),
    'por_dia',         (SELECT coalesce(jsonb_object_agg(data_slot, n),'{}') FROM (SELECT data_slot, count(*) n FROM s GROUP BY data_slot) d),
    'por_funcao',      (SELECT coalesce(jsonb_object_agg(tipo, n),'{}') FROM (SELECT tipo, count(*) n FROM s GROUP BY tipo) f),
    'gerado_auto',     (SELECT count(*) FROM s WHERE gerado_auto),
    'pct_preenchimento', CASE WHEN (SELECT total FROM preenchimento) > 0
      THEN round(100.0 * (SELECT preenchidos FROM preenchimento) / (SELECT total FROM preenchimento), 1)
      ELSE 0 END,
    'antecedencia_media_min', (SELECT coalesce(round(avg(antecedencia_min)::numeric, 0), 0) FROM aceites),
    'total_aceites',   (SELECT count(*) FROM aceites),
    'total_reabertos', (SELECT count(*) FROM s WHERE reaberto_em IS NOT NULL),
    'total_overrides', (SELECT count(*) FROM s WHERE override_em IS NOT NULL)
  );
$$;
