-- F3: View para tracking de prestadores ativos/ociosos

CREATE OR REPLACE VIEW public.v_prestador_status AS
SELECT
  u.id AS uid,
  u.nome,
  u.role,
  u.cidade,
  u.ultima_pos,
  t_ativa.id AS tarefa_ativa_id,
  t_ativa.kind AS tarefa_ativa_tipo,
  t_ativa.bike_id_atual,
  t_ativa.gojet_verified,
  CASE WHEN t_ativa.id IS NOT NULL
    THEN EXTRACT(EPOCH FROM (now() - t_ativa.criado_em)) / 60
    ELSE NULL
  END AS minutos_na_tarefa,
  t_ultima.concluido_em AS ultima_conclusao,
  CASE WHEN t_ativa.id IS NULL AND t_ultima.concluido_em IS NOT NULL
    THEN EXTRACT(EPOCH FROM (now() - t_ultima.concluido_em)) / 60
    ELSE NULL
  END AS minutos_ocioso,
  CASE
    WHEN t_ativa.id IS NOT NULL THEN 'em_tarefa'
    WHEN t_ultima.concluido_em IS NOT NULL
      AND EXTRACT(EPOCH FROM (now() - t_ultima.concluido_em)) / 60 < 30 THEN 'ocioso_curto'
    WHEN t_ultima.concluido_em IS NOT NULL
      AND EXTRACT(EPOCH FROM (now() - t_ultima.concluido_em)) / 60 < 60 THEN 'ocioso_medio'
    WHEN t_ultima.concluido_em IS NOT NULL THEN 'ocioso_longo'
    ELSE 'sem_acao'
  END AS status_prestador
FROM public.usuarios u
LEFT JOIN LATERAL (
  SELECT id, kind, criado_em, bike_id_atual, gojet_verified
  FROM public.tarefas_logistica
  WHERE assignee_uid = u.id AND status = 'em_execucao'
  ORDER BY criado_em DESC LIMIT 1
) t_ativa ON true
LEFT JOIN LATERAL (
  SELECT concluido_em
  FROM public.tarefas_logistica
  WHERE assignee_uid = u.id AND status = 'concluida' AND concluido_em IS NOT NULL
  ORDER BY concluido_em DESC LIMIT 1
) t_ultima ON true
WHERE u.role IN ('campo', 'prestador');
