-- F2/M3: Pontos especiais — estações com comportamento diferenciado
-- Tipos: feriado, evento, manutencao, sazonalidade

CREATE TABLE IF NOT EXISTS public.pontos_especiais (
  id          BIGSERIAL PRIMARY KEY,
  parking_id  TEXT NOT NULL,
  cidade_id   TEXT NOT NULL,
  tipo        TEXT NOT NULL,         -- 'feriado', 'evento', 'manutencao', 'sazonalidade'
  nome        TEXT,                  -- nome do evento/feriado
  data_inicio DATE NOT NULL,
  data_fim    DATE,
  config      JSONB DEFAULT '{}',   -- {meta_override, turno_override, prioridade}
  ativo       BOOLEAN DEFAULT true,
  criado_por  UUID,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pe_cidade ON public.pontos_especiais(cidade_id, data_inicio DESC);
CREATE INDEX IF NOT EXISTS idx_pe_parking ON public.pontos_especiais(parking_id, data_inicio DESC);

ALTER TABLE public.pontos_especiais ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='pontos_especiais' AND policyname='pe_sel') THEN
    CREATE POLICY pe_sel ON public.pontos_especiais FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='pontos_especiais' AND policyname='pe_all') THEN
    CREATE POLICY pe_all ON public.pontos_especiais FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='pontos_especiais' AND policyname='pe_svc') THEN
    CREATE POLICY pe_svc ON public.pontos_especiais FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
