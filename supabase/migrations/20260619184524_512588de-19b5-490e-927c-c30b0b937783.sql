REVOKE SELECT (file_bytes) ON public.export_jobs FROM authenticated;
REVOKE SELECT (file_bytes) ON public.export_jobs FROM anon;

DROP POLICY IF EXISTS "Users insert own upload jobs" ON public.upload_jobs;
CREATE POLICY "Users insert own upload jobs" ON public.upload_jobs
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND (company IS NULL OR public.user_has_company_access(auth.uid(), company))
  );