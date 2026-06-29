-- F1/M5: Tabela unificada de auditoria

CREATE TABLE IF NOT EXISTS public.audit_log (
  id          BIGSERIAL PRIMARY KEY,
  entidade    TEXT NOT NULL,        -- 'tarefa', 'bike', 'zona', 'config', 'usuario'
  entidade_id TEXT,                 -- ID da entidade afetada
  acao        TEXT NOT NULL,        -- 'criar', 'atualizar', 'excluir', 'validar', 'alertar'
  dados       JSONB,               -- detalhes do evento
  uid         UUID,                 -- quem fez (NULL = sistema/cron)
  ip          TEXT,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_entidade ON public.audit_log(entidade, entidade_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_audit_uid ON public.audit_log(uid, criado_em DESC) WHERE uid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_acao ON public.audit_log(acao, criado_em DESC);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='audit_log' AND policyname='al_sel') THEN
    CREATE POLICY al_sel ON public.audit_log FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='audit_log' AND policyname='al_svc') THEN
    CREATE POLICY al_svc ON public.audit_log FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
