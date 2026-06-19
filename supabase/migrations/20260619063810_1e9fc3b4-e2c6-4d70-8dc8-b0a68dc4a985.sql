
-- 1) has_role enforces is_active
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = _user_id
      AND role = _role
      AND is_active = true
  )
$$;

-- 2) Remove PHI-bearing tables from realtime publication to prevent
--    cross-tenant broadcast of patient data.
ALTER PUBLICATION supabase_realtime DROP TABLE public.parsed_rows;
ALTER PUBLICATION supabase_realtime DROP TABLE public.source_files;

-- 3) Protect export_jobs.file_bytes behind a logged SECURITY DEFINER RPC.
--    Revoke direct column read; clients must call download_export_job(id),
--    which records a phi_access_log entry before returning bytes.
REVOKE SELECT (file_bytes) ON public.export_jobs FROM authenticated, anon;
GRANT SELECT (id, requested_by, status, filters, name, filename, row_count, created_at, completed_at, error)
  ON public.export_jobs TO authenticated;

CREATE OR REPLACE FUNCTION public.download_export_job(_job_id uuid)
RETURNS TABLE(filename text, file_bytes bytea)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_job public.export_jobs%ROWTYPE;
  v_email text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_job FROM public.export_jobs WHERE id = _job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Export job not found';
  END IF;

  IF v_job.requested_by <> auth.uid() AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT email INTO v_email FROM public.profiles WHERE id = auth.uid();

  INSERT INTO public.phi_access_log(actor_id, actor_email, action, resource_type, resource_id, details)
  VALUES (auth.uid(), v_email, 'download', 'export_job', _job_id,
          jsonb_build_object('filename', v_job.filename, 'row_count', v_job.row_count));

  RETURN QUERY SELECT v_job.filename, v_job.file_bytes;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.download_export_job(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.download_export_job(uuid) TO authenticated;
