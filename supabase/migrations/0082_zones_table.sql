-- Tabela zones — polígonos GeoJSON por cidade (importados via CSV do Google MyMaps)
-- Portada do JET OS V2 (gojet-tasks-app)

CREATE TABLE IF NOT EXISTS public.zones (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  city        TEXT NOT NULL,
  geometry    JSONB NOT NULL,
  color       TEXT,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS zones_city_idx ON public.zones(city);

ALTER TABLE public.zones ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='zones' AND policyname='zones_sel') THEN
    CREATE POLICY zones_sel ON public.zones FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='zones' AND policyname='zones_all') THEN
    CREATE POLICY zones_all ON public.zones FOR ALL TO authenticated
      USING (true) WITH CHECK (true);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.touch_zones_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS zones_updated_at_trg ON public.zones;
CREATE TRIGGER zones_updated_at_trg
  BEFORE UPDATE ON public.zones
  FOR EACH ROW EXECUTE FUNCTION public.touch_zones_updated_at();
