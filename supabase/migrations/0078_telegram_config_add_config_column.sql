-- 0078 — Add config (jsonb) and atualizado_em columns to telegram_config
-- The TelegramConfigPanel stores global and per-city settings as jsonb in this column.
ALTER TABLE public.telegram_config ADD COLUMN IF NOT EXISTS config jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.telegram_config ADD COLUMN IF NOT EXISTS atualizado_em timestamptz;
