-- ============================================================================
-- JET OS — Fase 2 / Onda B switch — view de leitura de ocorrências (Guard)
-- Expõe lat/lng numéricos da coluna geography + firebase_uid do registrador
-- (join usuarios) p/ a read lib mapear de volta ao camelCase que o app usa.
-- Mirror de escrita (espelharOcorrenciaSupabase) já popula a tabela.
-- ============================================================================

-- security_invoker: a view respeita a RLS de ocorrencias do usuário que consulta
-- (gestor vê tudo; guard vê o que registrou) — ver policy ocor_sel (0008).
create or replace view public.ocorrencias_geo
  with (security_invoker = true) as
select
  o.id, o.firebase_doc_id, o.codigo,
  o.tipo, o.prioridade, o.status, o.ativo_tipo, o.asset_id,
  o.descricao, o.observacao_fechamento,
  ST_Y(o.geo::geometry) as lat,
  ST_X(o.geo::geometry) as lng,
  o.cidade, o.bairro, o.endereco, o.estacao_id,
  o.bo_numero, o.bo_url, o.foto1_url, o.foto2_url,
  o.cargo, o.origem_registro, o.turno, o.procurando,
  o.registrado_por,                       -- uuid Supabase
  u.firebase_uid as registrado_por_uid,   -- firebase uid (p/ casar com app)
  o.registrado_por_nome,
  o.telegram_enviado, o.data_manual,
  o.criado_em, o.atualizado_em
from public.ocorrencias o
left join public.usuarios u on u.id = o.registrado_por;
