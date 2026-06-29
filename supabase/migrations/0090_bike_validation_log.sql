-- F1/M3: Log de validações de bike (fantasma, GPS diverge, alugada, ok)

CREATE TABLE IF NOT EXISTS public.bike_validation_log (
  id          BIGSERIAL PRIMARY KEY,
  tarefa_id   UUID,
  uid_scout   UUID,
  bike_id     TEXT NOT NULL,
  tipo        TEXT NOT NULL,  -- 'fantasma', 'gps_diverge', 'alugada', 'ok', 'battery_0', 'battery_5'
  detalhes    JSONB,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bvl_bike ON public.bike_validation_log(bike_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_bvl_tipo ON public.bike_validation_log(tipo, criado_em DESC);

ALTER TABLE public.bike_validation_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='bike_validation_log' AND policyname='bvl_sel') THEN
    CREATE POLICY bvl_sel ON public.bike_validation_log FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='bike_validation_log' AND policyname='bvl_ins') THEN
    CREATE POLICY bvl_ins ON public.bike_validation_log FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='bike_validation_log' AND policyname='bvl_svc') THEN
    CREATE POLICY bvl_svc ON public.bike_validation_log FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
