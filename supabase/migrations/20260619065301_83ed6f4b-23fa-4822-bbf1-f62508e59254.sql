
-- 1) Protect source_files.file_bytes behind audited SECURITY DEFINER RPC
REVOKE SELECT (file_bytes) ON public.source_files FROM authenticated;
REVOKE SELECT (file_bytes) ON public.source_files FROM anon;

CREATE OR REPLACE FUNCTION public.download_source_file(_id uuid)
RETURNS TABLE(filename text, mime text, file_bytes bytea, kind text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_file public.source_files%ROWTYPE;
  v_email text;
  v_allowed boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_file FROM public.source_files WHERE id = _id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source file not found';
  END IF;

  v_allowed := (
    v_file.uploaded_by = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR (v_file.detected_company IS NOT NULL
        AND public.user_has_company_access(auth.uid(), v_file.detected_company))
  );
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT email INTO v_email FROM public.profiles WHERE id = auth.uid();

  INSERT INTO public.phi_access_log(user_id, action, target_table, target_id, source_file_id, details)
  VALUES (auth.uid(), 'download_source_file', 'source_files', _id, _id,
          jsonb_build_object('filename', v_file.filename, 'actor_email', v_email));

  RETURN QUERY SELECT v_file.filename, v_file.mime, v_file.file_bytes, v_file.kind;
END;
$$;

REVOKE ALL ON FUNCTION public.download_source_file(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.download_source_file(uuid) TO authenticated;

-- 2) Lock down phi_access_log writes to SECURITY DEFINER paths only
DROP POLICY IF EXISTS "Users insert their own access entries" ON public.phi_access_log;
REVOKE INSERT ON public.phi_access_log FROM authenticated;
REVOKE INSERT ON public.phi_access_log FROM anon;

CREATE OR REPLACE FUNCTION public.log_phi_access(
  _action text,
  _target_table text DEFAULT NULL,
  _target_id uuid DEFAULT NULL,
  _source_file_id uuid DEFAULT NULL,
  _row_count integer DEFAULT NULL,
  _details jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_email text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF _action IS NULL OR length(trim(_action)) = 0 THEN
    RAISE EXCEPTION 'action required';
  END IF;

  SELECT email INTO v_email FROM public.profiles WHERE id = auth.uid();

  INSERT INTO public.phi_access_log(user_id, action, target_table, target_id, source_file_id, row_count, details)
  VALUES (auth.uid(), _action, _target_table, _target_id, _source_file_id, _row_count,
          coalesce(_details, '{}'::jsonb) || jsonb_build_object('actor_email', v_email));
END;
$$;

REVOKE ALL ON FUNCTION public.log_phi_access(text, text, uuid, uuid, integer, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_phi_access(text, text, uuid, uuid, integer, jsonb) TO authenticated;
