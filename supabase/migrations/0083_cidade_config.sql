-- cidade_config — tabela unificada de configuração por cidade
-- Substitui gojet_config fragmentado. Alimentada por sync automático da API GoJet.
-- Row '_default' contém config herdada por cidades sem override.

CREATE TABLE IF NOT EXISTS public.cidade_config (
  id              TEXT PRIMARY KEY,              -- GoJet city_id ou '_default'
  nome            TEXT NOT NULL,
  timezone        TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  ativo           BOOLEAN NOT NULL DEFAULT false,
  gojet_removida  BOOLEAN NOT NULL DEFAULT false,
  config          JSONB NOT NULL DEFAULT '{}'::jsonb,
  zonas_importadas BOOLEAN NOT NULL DEFAULT false,
  total_bikes     INT,
  total_parkings  INT,
  total_zones     INT,
  ultima_sync     TIMESTAMPTZ,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Row default com config base
INSERT INTO public.cidade_config (id, nome, config) VALUES (
  '_default', 'Configuração padrão', jsonb_build_object(
    'limite_default', 3,
    'scraper_interval_min', 15,
    'sla_minutos', 60,
    'turnos', jsonb_build_object(
      'T0', jsonb_build_object('inicio', '00:00', 'fim', '08:00'),
      'T1', jsonb_build_object('inicio', '08:00', 'fim', '16:00'),
      'T2', jsonb_build_object('inicio', '16:00', 'fim', '00:00')
    )
  )
) ON CONFLICT (id) DO NOTHING;

-- Migrar dados existentes de gojet_config (se existir)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'gojet_config' AND table_schema = 'public') THEN
    INSERT INTO public.cidade_config (id, nome, ativo, config)
    SELECT
      city_id AS id,
      COALESCE(nome, cidade, city_id) AS nome,
      COALESCE(ativo, false) AS ativo,
      '{}'::jsonb AS config
    FROM public.gojet_config
    WHERE cidade != '_default'
    ON CONFLICT (id) DO UPDATE SET
      nome = EXCLUDED.nome,
      ativo = EXCLUDED.ativo;
  END IF;
END $$;

-- RLS
ALTER TABLE public.cidade_config ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='cidade_config' AND policyname='cc_sel') THEN
    CREATE POLICY cc_sel ON public.cidade_config FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='cidade_config' AND policyname='cc_all') THEN
    CREATE POLICY cc_all ON public.cidade_config FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='cidade_config' AND policyname='cc_svc') THEN
    CREATE POLICY cc_svc ON public.cidade_config FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_cidade_config_updated_at() RETURNS trigger AS $$
BEGIN NEW.atualizado_em = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cidade_config_updated_at_trg ON public.cidade_config;
CREATE TRIGGER cidade_config_updated_at_trg
  BEFORE UPDATE ON public.cidade_config
  FOR EACH ROW EXECUTE FUNCTION public.touch_cidade_config_updated_at();
