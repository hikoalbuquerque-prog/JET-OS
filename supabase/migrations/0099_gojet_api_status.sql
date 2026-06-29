-- T2: GoJet API fallback — track API health per city
ALTER TABLE cidade_config
  ADD COLUMN IF NOT EXISTS gojet_api_status TEXT NOT NULL DEFAULT 'ok'
    CHECK (gojet_api_status IN ('ok', 'degraded', 'down')),
  ADD COLUMN IF NOT EXISTS gojet_api_last_ok TIMESTAMPTZ;
