-- F2/M4: Fila de verificação pós-entrega GoJet

CREATE TABLE IF NOT EXISTS public.gojet_verify_queue (
  id                BIGSERIAL PRIMARY KEY,
  tarefa_id         UUID REFERENCES public.tarefas_logistica(id),
  parking_id        TEXT NOT NULL,
  bikes_count_before INT,
  bikes_count_after  INT,
  status            TEXT NOT NULL DEFAULT 'pendente',  -- pendente | ok | fail | timeout
  tentativas        INT DEFAULT 0,
  max_tentativas    INT DEFAULT 7,  -- 7×5min = 35min
  criado_em         TIMESTAMPTZ NOT NULL DEFAULT now(),
  verificado_em     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_gvq_status ON public.gojet_verify_queue(status)
  WHERE status = 'pendente';
CREATE INDEX IF NOT EXISTS idx_gvq_tarefa ON public.gojet_verify_queue(tarefa_id);

ALTER TABLE public.gojet_verify_queue ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='gojet_verify_queue' AND policyname='gvq_sel') THEN
    CREATE POLICY gvq_sel ON public.gojet_verify_queue FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='gojet_verify_queue' AND policyname='gvq_svc') THEN
    CREATE POLICY gvq_svc ON public.gojet_verify_queue FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
