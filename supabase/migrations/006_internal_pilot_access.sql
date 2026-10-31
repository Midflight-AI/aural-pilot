-- Internal pilot only: all interview data goes through the protected web app.
-- Do not remove Vercel All Deployments protection while this model is in use.
-- Upstream tRPC uses service_role; the browser only needs its own profile.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.profiles TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- Media is uploaded and signed by server routes, not by anonymous clients.
REVOKE ALL ON storage.objects FROM anon, authenticated;
UPDATE storage.buckets SET public = false;

CREATE SCHEMA IF NOT EXISTS pilot_private;
REVOKE ALL ON SCHEMA pilot_private FROM PUBLIC, anon, authenticated;
CREATE TABLE pilot_private.allowed_emails (
  email text PRIMARY KEY CHECK (email = lower(email))
);
ALTER TABLE pilot_private.allowed_emails ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION pilot_private.require_approved_tester()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pilot_private.allowed_emails WHERE email = lower(NEW.email)
  ) THEN
    RAISE EXCEPTION 'This pilot is restricted to approved internal testers';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION pilot_private.require_approved_tester() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER require_approved_pilot_tester
  BEFORE INSERT OR UPDATE OF email ON auth.users
  FOR EACH ROW EXECUTE FUNCTION pilot_private.require_approved_tester();

-- Future migrations must explicitly grant any intended browser capability.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;
