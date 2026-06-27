-- 0060_onda_g_telegram_gojet_columns.sql
-- Onda G: adiciona colunas faltantes para telegram_config, telegram_vinculos,
-- gojet_config, e tarefas_logistica (mirror).

-- ── telegram_config — colunas para roteamento por cidade ────────────────────
ALTER TABLE public.telegram_config ADD COLUMN IF NOT EXISTS bot_username text;
ALTER TABLE public.telegram_config ADD COLUMN IF NOT EXISTS relatorios_chat_id text;
ALTER TABLE public.telegram_config ADD COLUMN IF NOT EXISTS relatorios_thread_id text;
ALTER TABLE public.telegram_config ADD COLUMN IF NOT EXISTS diretoria jsonb DEFAULT '[]';
ALTER TABLE public.telegram_config ADD COLUMN IF NOT EXISTS regionais jsonb DEFAULT '[]';
ALTER TABLE public.telegram_config ADD COLUMN IF NOT EXISTS cidades jsonb DEFAULT '{}';
ALTER TABLE public.telegram_config ADD COLUMN IF NOT EXISTS chat_ids jsonb DEFAULT '{}';

-- Permitir service_role full access (mirrors e Cloud Functions)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='telegram_config' AND policyname='tgcfg_service') THEN
    CREATE POLICY tgcfg_service ON public.telegram_config FOR ALL TO service_role USING (true);
  END IF;
END $$;

-- ── telegram_vinculos — coluna uid para deep-link 1-toque ──────────────────
ALTER TABLE public.telegram_vinculos ADD COLUMN IF NOT EXISTS uid text;
ALTER TABLE public.telegram_vinculos ADD COLUMN IF NOT EXISTS modo text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='telegram_vinculos' AND policyname='tgvin_service') THEN
    CREATE POLICY tgvin_service ON public.telegram_vinculos FOR ALL TO service_role USING (true);
  END IF;
END $$;

-- ── gojet_config — colunas extras do Firestore ─────────────────────────────
ALTER TABLE public.gojet_config ADD COLUMN IF NOT EXISTS nome text;
ALTER TABLE public.gojet_config ADD COLUMN IF NOT EXISTS pais text DEFAULT 'BR';
ALTER TABLE public.gojet_config ADD COLUMN IF NOT EXISTS cookie text;
ALTER TABLE public.gojet_config ADD COLUMN IF NOT EXISTS scraper_url text;
ALTER TABLE public.gojet_config ADD COLUMN IF NOT EXISTS criado_em timestamptz DEFAULT now();

-- ── tarefas_logistica — colunas extras para mirror (campos Firestore) ──────
ALTER TABLE public.tarefas_logistica ADD COLUMN IF NOT EXISTS parking_id text;
ALTER TABLE public.tarefas_logistica ADD COLUMN IF NOT EXISTS parking_nome text;
ALTER TABLE public.tarefas_logistica ADD COLUMN IF NOT EXISTS parking_lat double precision;
ALTER TABLE public.tarefas_logistica ADD COLUMN IF NOT EXISTS parking_lng double precision;
ALTER TABLE public.tarefas_logistica ADD COLUMN IF NOT EXISTS target_count int;
ALTER TABLE public.tarefas_logistica ADD COLUMN IF NOT EXISTS delivered_count int DEFAULT 0;
ALTER TABLE public.tarefas_logistica ADD COLUMN IF NOT EXISTS assignee_nome text;
ALTER TABLE public.tarefas_logistica ADD COLUMN IF NOT EXISTS pais text DEFAULT 'BR';
ALTER TABLE public.tarefas_logistica ADD COLUMN IF NOT EXISTS prioridade int;
ALTER TABLE public.tarefas_logistica ADD COLUMN IF NOT EXISTS gerado_por_gojet boolean DEFAULT false;
ALTER TABLE public.tarefas_logistica ADD COLUMN IF NOT EXISTS slot_id text;
ALTER TABLE public.tarefas_logistica ADD COLUMN IF NOT EXISTS check_in_gps boolean DEFAULT false;
ALTER TABLE public.tarefas_logistica ADD COLUMN IF NOT EXISTS atualizado_em timestamptz DEFAULT now();

-- ── tarefas — colunas extras para mirror ───────────────────────────────────
ALTER TABLE public.tarefas ADD COLUMN IF NOT EXISTS titulo text;
ALTER TABLE public.tarefas ADD COLUMN IF NOT EXISTS cargo text;
ALTER TABLE public.tarefas ADD COLUMN IF NOT EXISTS tipo_slot text;
ALTER TABLE public.tarefas ADD COLUMN IF NOT EXISTS slot_id text;
ALTER TABLE public.tarefas ADD COLUMN IF NOT EXISTS assignee_uid text;
ALTER TABLE public.tarefas ADD COLUMN IF NOT EXISTS assignee_nome text;
ALTER TABLE public.tarefas ADD COLUMN IF NOT EXISTS qtd_alvo int;
ALTER TABLE public.tarefas ADD COLUMN IF NOT EXISTS qtd_concluida int DEFAULT 0;
ALTER TABLE public.tarefas ADD COLUMN IF NOT EXISTS rota_ordem int;
ALTER TABLE public.tarefas ADD COLUMN IF NOT EXISTS estacao jsonb;

-- Service role policies para mirrors
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='tarefas' AND policyname='tarefas_service') THEN
    CREATE POLICY tarefas_service ON public.tarefas FOR ALL TO service_role USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='tarefas_logistica' AND policyname='tarefas_log_service') THEN
    CREATE POLICY tarefas_log_service ON public.tarefas_logistica FOR ALL TO service_role USING (true);
  END IF;
END $$;
