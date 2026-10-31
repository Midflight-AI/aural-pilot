-- Storage's managed owner can retain/reapply its table grants. Enforce the
-- pilot restriction with RLS as well; service_role still bypasses RLS.
CREATE POLICY "Internal pilot blocks direct browser media access"
ON storage.objects AS RESTRICTIVE FOR ALL TO anon, authenticated
USING (false) WITH CHECK (false);
