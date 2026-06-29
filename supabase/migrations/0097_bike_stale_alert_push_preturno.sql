-- B5.1: View para bikes sem movimento >72h (baseado em gojet snapshots)
-- Usa tabela bikes.dados->>'status_since' (timestamp ms do último movimento)

CREATE OR REPLACE VIEW public.v_bikes_stale AS
SELECT
  b.id AS bike_row_id,
  (b.dados->>'id')::text AS bike_id,
  (b.dados->>'identifier')::text AS identifier,
  (b.dados->>'parking_id')::text AS parking_id,
  (b.dados->>'battery_percent')::int AS battery_percent,
  b.city_id,
  b.atualizado_em,
  EXTRACT(EPOCH FROM (now() - b.atualizado_em)) / 3600 AS horas_parado
FROM public.bikes b
WHERE b.atualizado_em < now() - interval '72 hours';

GRANT SELECT ON public.v_bikes_stale TO authenticated, service_role;

-- B5.4: Tabela para configuração de turnos (para push pré-turno)
CREATE TABLE IF NOT EXISTS public.turnos_config (
  id          BIGSERIAL PRIMARY KEY,
  cidade      TEXT NOT NULL,
  nome        TEXT NOT NULL,          -- T0, T1, T2
  inicio      TIME NOT NULL,         -- 23:00, 07:00, 15:00
  fim         TIME NOT NULL,         -- 07:00, 15:00, 23:00
  ativo       BOOLEAN DEFAULT true,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_turnos_cidade_nome ON public.turnos_config(cidade, nome);

ALTER TABLE public.turnos_config ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='turnos_config' AND policyname='tc_sel') THEN
    CREATE POLICY tc_sel ON public.turnos_config FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='turnos_config' AND policyname='tc_all') THEN
    CREATE POLICY tc_all ON public.turnos_config FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Seed turnos padrão
INSERT INTO public.turnos_config (cidade, nome, inicio, fim) VALUES
  ('_default', 'T0', '23:00', '07:00'),
  ('_default', 'T1', '07:00', '15:00'),
  ('_default', 'T2', '15:00', '23:00')
ON CONFLICT (cidade, nome) DO NOTHING;

-- View: próximo turno por cidade (para push pré-turno)
CREATE OR REPLACE VIEW public.v_proximo_turno AS
SELECT
  tc.cidade,
  tc.nome AS turno,
  tc.inicio,
  tc.fim,
  CASE
    WHEN tc.inicio > LOCALTIME THEN tc.inicio - LOCALTIME
    ELSE tc.inicio + interval '24 hours' - LOCALTIME
  END AS tempo_ate_inicio
FROM public.turnos_config tc
WHERE tc.ativo = true
ORDER BY tempo_ate_inicio ASC;

GRANT SELECT ON public.v_proximo_turno TO authenticated, service_role;
