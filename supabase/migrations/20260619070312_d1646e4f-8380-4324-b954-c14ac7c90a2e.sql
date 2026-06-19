
-- 1. Revoke SELECT on file_bytes columns; downloads go through audited RPCs.
REVOKE SELECT (file_bytes) ON public.source_files FROM authenticated, anon;
REVOKE SELECT (file_bytes) ON public.export_jobs FROM authenticated, anon;

-- Grant SELECT on the remaining columns explicitly so list/read continues to work.
DO $$
DECLARE
  col text;
BEGIN
  FOR col IN
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='source_files' AND column_name <> 'file_bytes'
  LOOP
    EXECUTE format('GRANT SELECT (%I) ON public.source_files TO authenticated', col);
  END LOOP;
  FOR col IN
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='export_jobs' AND column_name <> 'file_bytes'
  LOOP
    EXECUTE format('GRANT SELECT (%I) ON public.export_jobs TO authenticated', col);
  END LOOP;
END $$;

-- 2. file_activity_log: prevent forged inserts from the client (the SECURITY DEFINER
--    trigger inserts as table owner and is unaffected by these revokes).
REVOKE INSERT, UPDATE, DELETE ON public.file_activity_log FROM authenticated, anon;

-- Tighten SELECT: only entries for files the user owns/has company access to (or admins).
DROP POLICY IF EXISTS "Users read their own activity" ON public.file_activity_log;
DROP POLICY IF EXISTS "file_activity_log_select" ON public.file_activity_log;
CREATE POLICY "file_activity_log_select" ON public.file_activity_log
FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR EXISTS (
    SELECT 1 FROM public.source_files sf
    WHERE sf.id = file_activity_log.source_file_id
      AND (
        sf.uploaded_by = auth.uid()
        OR (sf.detected_company IS NOT NULL
            AND public.user_has_company_access(auth.uid(), sf.detected_company))
      )
  )
);

-- 3. upload_jobs: explicit DELETE policy (owner or admin).
DROP POLICY IF EXISTS "upload_jobs_delete" ON public.upload_jobs;
CREATE POLICY "upload_jobs_delete" ON public.upload_jobs
FOR DELETE TO authenticated
USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- 4. Lock down SECURITY DEFINER functions: revoke from public/anon, grant to authenticated.
REVOKE EXECUTE ON FUNCTION public.download_source_file(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.download_export_job(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.log_phi_access(text, text, uuid, uuid, integer, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.user_has_company_access(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.flag_duplicate_parsed_rows(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.evaluate_alert_rules() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_dashboard_stats(text[], text[], text[], text[], date, date, integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.download_source_file(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.download_export_job(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_phi_access(text, text, uuid, uuid, integer, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_company_access(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_stats(text[], text[], text[], text[], date, date, integer) TO authenticated;
-- flag_duplicate_parsed_rows + evaluate_alert_rules remain backend-only (service_role still has access).
