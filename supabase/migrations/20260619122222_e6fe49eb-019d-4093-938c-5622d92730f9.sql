
-- 1) Revoke direct SELECT on export_jobs.file_bytes from authenticated
REVOKE SELECT (file_bytes) ON public.export_jobs FROM authenticated;

-- 2) Explicit restrictive policies to block direct writes on audit/log tables
-- phi_access_log: only SECURITY DEFINER functions (running as postgres) may write
DROP POLICY IF EXISTS "Deny client writes on phi_access_log" ON public.phi_access_log;
CREATE POLICY "Deny client writes on phi_access_log"
  ON public.phi_access_log
  AS RESTRICTIVE
  FOR ALL
  TO authenticated, anon
  USING (false)
  WITH CHECK (false);

-- file_activity_log: only trigger (SECURITY DEFINER) writes
DROP POLICY IF EXISTS "Deny client writes on file_activity_log" ON public.file_activity_log;
CREATE POLICY "Deny client writes on file_activity_log"
  ON public.file_activity_log
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (false);

DROP POLICY IF EXISTS "Deny client updates on file_activity_log" ON public.file_activity_log;
CREATE POLICY "Deny client updates on file_activity_log"
  ON public.file_activity_log
  AS RESTRICTIVE
  FOR UPDATE
  TO authenticated, anon
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS "Deny client deletes on file_activity_log" ON public.file_activity_log;
CREATE POLICY "Deny client deletes on file_activity_log"
  ON public.file_activity_log
  AS RESTRICTIVE
  FOR DELETE
  TO authenticated, anon
  USING (false);

-- 3) claims_raw: explicit restrictive policy denying non-admin client writes
-- Admin ALL policy continues to allow admin operations; service_role bypasses RLS.
DROP POLICY IF EXISTS "Deny non-admin client writes on claims_raw" ON public.claims_raw;
CREATE POLICY "Deny non-admin client writes on claims_raw"
  ON public.claims_raw
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Deny non-admin client updates on claims_raw" ON public.claims_raw;
CREATE POLICY "Deny non-admin client updates on claims_raw"
  ON public.claims_raw
  AS RESTRICTIVE
  FOR UPDATE
  TO authenticated, anon
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Deny non-admin client deletes on claims_raw" ON public.claims_raw;
CREATE POLICY "Deny non-admin client deletes on claims_raw"
  ON public.claims_raw
  AS RESTRICTIVE
  FOR DELETE
  TO authenticated, anon
  USING (public.has_role(auth.uid(), 'admin'));

COMMENT ON TABLE public.claims_raw IS 'Claims data. Inserts are performed exclusively by SECURITY DEFINER server-side functions (process-upload, reparse-source-file) using service_role. Client writes are restricted to admins.';
COMMENT ON TABLE public.phi_access_log IS 'PHI audit log. Writes only via log_phi_access() SECURITY DEFINER function. Direct client writes are blocked.';
COMMENT ON TABLE public.file_activity_log IS 'Source file activity audit. Writes only via log_source_file_activity() trigger (SECURITY DEFINER). Direct client writes are blocked.';
COMMENT ON COLUMN public.export_jobs.file_bytes IS 'PHI export bytes. Direct SELECT revoked from authenticated; read only via download_export_job() SECURITY DEFINER function.';
