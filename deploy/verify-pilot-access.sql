-- Run against the isolated pilot after migration 006. No records are retained.
BEGIN;
DO $$
BEGIN
  IF has_table_privilege('anon', 'public.candidates', 'SELECT')
     OR has_table_privilege('authenticated', 'public.candidates', 'SELECT')
     OR has_table_privilege('authenticated', 'public.sessions', 'UPDATE') THEN
    RAISE EXCEPTION 'Pilot browser access boundary is open';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.candidates', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.profiles', 'SELECT') THEN
    RAISE EXCEPTION 'Required server/profile access is missing';
  END IF;
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE public) THEN
    RAISE EXCEPTION 'Public media bucket found';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prosecdef
      AND (has_function_privilege('anon',p.oid,'EXECUTE')
           OR has_function_privilege('authenticated',p.oid,'EXECUTE'))
  ) THEN
    RAISE EXCEPTION 'A privileged public RPC is exposed';
  END IF;
  BEGIN
    INSERT INTO auth.users(id,email) VALUES (gen_random_uuid(),'not-approved@example.invalid');
    RAISE EXCEPTION 'Unapproved signup unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'This pilot is restricted to approved internal testers' THEN RAISE; END IF;
  END;
END;
$$;
INSERT INTO storage.objects(bucket_id,name)
SELECT id, 'pilot-access-check' FROM storage.buckets WHERE id='recordings';
SET LOCAL ROLE anon;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM storage.objects WHERE name='pilot-access-check') THEN
    RAISE EXCEPTION 'Anonymous media read succeeded';
  END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM storage.objects WHERE name='pilot-access-check') THEN
    RAISE EXCEPTION 'Direct authenticated media read succeeded';
  END IF;
END $$;
RESET ROLE;
ROLLBACK;
