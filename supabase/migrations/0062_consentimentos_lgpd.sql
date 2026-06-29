-- 0062_consentimentos_lgpd.sql
-- Recria tabela consentimentos_lgpd com schema alinhado ao Firestore (uid text, versao int).
-- A tabela anterior (0001) usava uid uuid FK + id text PK; esta versao usa bigint identity
-- e uid text (Firebase UID), compativel com o mirror e o frontend.

DROP TABLE IF EXISTS public.consentimentos_lgpd CASCADE;

CREATE TABLE IF NOT EXISTS public.consentimentos_lgpd (
  id bigint generated always as identity primary key,
  uid text not null,
  email text,
  nome text,
  role text,
  versao int not null default 1,
  aceito_em timestamptz not null default now(),
  dispositivo text,
  idioma text,
  criado_em timestamptz not null default now(),
  UNIQUE(uid, versao)
);

-- Immutable: only insert, no update/delete
ALTER TABLE public.consentimentos_lgpd ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role full" ON public.consentimentos_lgpd FOR ALL TO service_role USING (true);
CREATE POLICY "auth insert" ON public.consentimentos_lgpd FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "own read" ON public.consentimentos_lgpd FOR SELECT TO authenticated USING (uid = (select firebase_uid from public.usuarios where id = auth.uid()));
