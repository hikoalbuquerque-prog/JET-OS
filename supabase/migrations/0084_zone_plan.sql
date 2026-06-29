-- zone_plan — adiciona campos de planejamento na tabela zones
-- plan_frota: meta de bikes na zona
-- limite_default: limite padrão para pontos não-monitor (default 3)
-- gojet_zone_id: ID da zona no GoJet (para sync automático)

ALTER TABLE public.zones
  ADD COLUMN IF NOT EXISTS plan_frota      INT,
  ADD COLUMN IF NOT EXISTS limite_default  INT NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS gojet_zone_id   TEXT;

CREATE INDEX IF NOT EXISTS zones_gojet_zone_id_idx ON public.zones(gojet_zone_id)
  WHERE gojet_zone_id IS NOT NULL;

-- Unique constraint para upsert de zonas importadas do GoJet
CREATE UNIQUE INDEX IF NOT EXISTS zones_city_gojet_zone_id_uniq
  ON public.zones(city, gojet_zone_id) WHERE gojet_zone_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS zones_city_name_uniq
  ON public.zones(city, name);
