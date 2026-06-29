-- F5: Proximity assignment + auto-priorização de tarefas

-- Função: encontrar scout mais próximo disponível
CREATE OR REPLACE FUNCTION public.nearest_available_scout(
  p_cidade text,
  p_lat double precision,
  p_lng double precision,
  p_max_distance_m int DEFAULT 10000
)
RETURNS TABLE(
  uid uuid,
  nome text,
  distancia_m double precision,
  status_prestador text
) LANGUAGE sql STABLE AS $$
  SELECT
    u.id AS uid,
    u.nome,
    ST_Distance(u.ultima_pos, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography) AS distancia_m,
    COALESCE(v.status_prestador, 'sem_acao') AS status_prestador
  FROM public.usuarios u
  LEFT JOIN public.v_prestador_status v ON v.uid = u.id
  WHERE u.role IN ('campo', 'prestador')
    AND u.cidade = p_cidade
    AND u.ultima_pos IS NOT NULL
    AND u.ultima_pos_em > now() - interval '2 hours'
    AND COALESCE(v.status_prestador, 'sem_acao') != 'em_tarefa'
    AND ST_DWithin(u.ultima_pos, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography, p_max_distance_m)
  ORDER BY distancia_m ASC
  LIMIT 5;
$$;

-- Função: calcular score de prioridade de uma tarefa
-- Score maior = mais urgente
CREATE OR REPLACE FUNCTION public.tarefa_priority_score(
  p_tarefa_id uuid
)
RETURNS double precision LANGUAGE sql STABLE AS $$
  SELECT
    -- Tempo desde criação (mais antiga = mais urgente), max 100 pts
    LEAST(EXTRACT(EPOCH FROM (now() - t.criado_em)) / 60, 300) / 3
    -- É tarefa de ponto (rebalanceamento/zero-fill)? +30 pts
    + CASE WHEN t.kind IN ('PONTO', 'ORGANIZACAO') THEN 30 ELSE 0 END
    -- Bateria/carga? +40 pts
    + CASE WHEN t.kind = 'CARGA_BATERIA' THEN 40 ELSE 0 END
    -- Tem bike_ids definidos (tarefa específica)? +10 pts
    + CASE WHEN t.bike_ids IS NOT NULL AND array_length(t.bike_ids, 1) > 0 THEN 10 ELSE 0 END
  FROM public.tarefas_logistica t
  WHERE t.id = p_tarefa_id;
$$;

-- View: tarefas pendentes com score + localização destino
CREATE OR REPLACE VIEW public.v_tarefas_pendentes_ranked AS
SELECT
  t.id,
  t.kind,
  t.cidade,
  t.criado_em,
  t.destino_lat,
  t.destino_lng,
  t.destino_nome,
  t.parking_destino,
  t.bike_ids,
  public.tarefa_priority_score(t.id) AS priority_score,
  t.assignee_uid
FROM public.tarefas_logistica t
WHERE t.status = 'pendente'
ORDER BY public.tarefa_priority_score(t.id) DESC;

-- Grants
GRANT EXECUTE ON FUNCTION public.nearest_available_scout TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tarefa_priority_score TO authenticated, service_role;
GRANT SELECT ON public.v_tarefas_pendentes_ranked TO authenticated, service_role;
