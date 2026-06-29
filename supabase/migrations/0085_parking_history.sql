-- parking_history — histórico de aluguéis por ponto/hora
-- Fonte primária: GoJet ML API (/api/v0/ml/techzones/{id}/activity)
-- Fallback: delta de snapshots (bikes_count entre snapshots)

-- Se a tabela já existe (de migration anterior), dropar e recriar com schema correto
DROP TABLE IF EXISTS public.parking_history CASCADE;

CREATE TABLE public.parking_history (
  id              BIGSERIAL PRIMARY KEY,
  parking_id      TEXT NOT NULL,
  cidade_id       TEXT NOT NULL,
  zona_id         TEXT,
  bikes_count     INT,
  starts          INT NOT NULL DEFAULT 0,
  finishes        INT NOT NULL DEFAULT 0,
  hora            TIMESTAMPTZ NOT NULL,
  fonte           TEXT NOT NULL DEFAULT 'gojet_ml',
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ph_parking_hora ON public.parking_history(parking_id, hora DESC);
CREATE INDEX idx_ph_cidade_hora ON public.parking_history(cidade_id, hora DESC);
CREATE INDEX idx_ph_zona_hora ON public.parking_history(zona_id, hora DESC) WHERE zona_id IS NOT NULL;

CREATE UNIQUE INDEX idx_ph_unique ON public.parking_history(parking_id, hora, fonte);

ALTER TABLE public.parking_history ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='parking_history' AND policyname='ph_sel') THEN
    CREATE POLICY ph_sel ON public.parking_history FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='parking_history' AND policyname='ph_svc') THEN
    CREATE POLICY ph_svc ON public.parking_history FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
