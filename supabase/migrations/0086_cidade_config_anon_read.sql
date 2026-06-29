-- Allow anon role to read cidade_config (needed when Supabase session not yet established)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='cidade_config' AND policyname='cc_anon_sel') THEN
    CREATE POLICY cc_anon_sel ON public.cidade_config FOR SELECT TO anon USING (true);
  END IF;
END $$;
