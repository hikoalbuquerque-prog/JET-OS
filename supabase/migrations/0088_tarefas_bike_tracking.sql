-- F1/M1: Bike tracking columns on tarefas_logistica
-- Adds bike IDs, destination, route, GoJet verification status

ALTER TABLE public.tarefas_logistica
  ADD COLUMN IF NOT EXISTS bike_ids             TEXT[],
  ADD COLUMN IF NOT EXISTS bike_id_atual        TEXT,
  ADD COLUMN IF NOT EXISTS parking_destino      TEXT,
  ADD COLUMN IF NOT EXISTS destino_lat          DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS destino_lng          DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS destino_nome         TEXT,
  ADD COLUMN IF NOT EXISTS rota_osrm            JSONB,
  ADD COLUMN IF NOT EXISTS eta_minutos          INT,
  ADD COLUMN IF NOT EXISTS gojet_verified       BOOLEAN,
  ADD COLUMN IF NOT EXISTS gojet_verified_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verificacao_tentativas INT DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_tarefas_bike_atual ON public.tarefas_logistica(bike_id_atual)
  WHERE bike_id_atual IS NOT NULL;
