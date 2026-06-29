-- F1/M2: Log de trocas de bike durante turno

CREATE TABLE IF NOT EXISTS public.bike_swap_log (
  id          BIGSERIAL PRIMARY KEY,
  tarefa_id   UUID REFERENCES public.tarefas_logistica(id),
  uid_scout   UUID REFERENCES public.usuarios(id),
  bike_id_old TEXT NOT NULL,
  bike_id_new TEXT NOT NULL,
  motivo      TEXT,  -- 'alugada', 'defeito', 'bateria', 'manual'
  gps_scout   JSONB,
  gps_bike    JSONB,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.bike_swap_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='bike_swap_log' AND policyname='bsl_sel') THEN
    CREATE POLICY bsl_sel ON public.bike_swap_log FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='bike_swap_log' AND policyname='bsl_ins') THEN
    CREATE POLICY bsl_ins ON public.bike_swap_log FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='bike_swap_log' AND policyname='bsl_svc') THEN
    CREATE POLICY bsl_svc ON public.bike_swap_log FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
