-- 0059_tarefas_firebase_id.sql
-- Add firebase_id to tarefas and tarefas_logistica for mirror upsert (Onda H).
-- Also create solicitacoes table for user access requests (auth/index.ts).

-- ── tarefas (schema 0036) ───────────────────────────────────────────────────
ALTER TABLE public.tarefas ADD COLUMN IF NOT EXISTS firebase_id text;
CREATE UNIQUE INDEX IF NOT EXISTS uq_tarefas_firebase_id ON public.tarefas(firebase_id);

-- ── tarefas_logistica (schema 0001) ─────────────────────────────────────────
ALTER TABLE public.tarefas_logistica ADD COLUMN IF NOT EXISTS firebase_id text;
CREATE UNIQUE INDEX IF NOT EXISTS uq_tarefas_logistica_firebase_id ON public.tarefas_logistica(firebase_id);

-- ── solicitacoes (user access requests — distinct from solicitacoes_prestadores) ─
-- Maps to Firestore collection "solicitacoes" used in functions/src/auth/index.ts.
-- Fields: email, nome, paises (array), motivo, roleDesejado, status, timestamps.
CREATE TABLE IF NOT EXISTS public.solicitacoes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firebase_id     text UNIQUE,
  email           text NOT NULL,
  nome            text,
  paises          text[] DEFAULT '{BR}',
  motivo          text,
  role_desejado   text DEFAULT 'campo',
  status          text NOT NULL DEFAULT 'PENDENTE',
  resolvido_em    timestamptz,
  resolvido_por   text,
  role_atribuido  text,
  criado_em       timestamptz NOT NULL DEFAULT now()
);

-- RLS: service_role bypasses; authenticated read-only for gestores
ALTER TABLE public.solicitacoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY solicitacoes_read ON public.solicitacoes FOR SELECT TO authenticated USING (true);
CREATE POLICY solicitacoes_service ON public.solicitacoes FOR ALL TO service_role USING (true);
