-- Fix: partial unique index can't be used by PostgREST ON CONFLICT.
-- Drop the partial index and create a proper unique constraint.

DROP INDEX IF EXISTS zones_city_gojet_zone_id_uniq;

-- Create a non-partial unique index (NULLs are distinct in PG unique indexes, so this is safe)
CREATE UNIQUE INDEX IF NOT EXISTS zones_city_gojet_zone_uniq
  ON public.zones(city, gojet_zone_id);

-- Also add service_role policy for Edge Function upserts
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='zones' AND policyname='zones_svc') THEN
    CREATE POLICY zones_svc ON public.zones FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
