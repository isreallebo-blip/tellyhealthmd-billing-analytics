
-- 1) Revoke column-level SELECT on export_jobs.file_bytes from authenticated
REVOKE SELECT (file_bytes) ON public.export_jobs FROM authenticated;

-- 2) Remove direct INSERT policy on file_activity_log; only SECURITY DEFINER trigger writes
DROP POLICY IF EXISTS "Authenticated insert own activity" ON public.file_activity_log;

-- 3) Add INSERT policy on parsed_rows requiring ownership of source_file or admin
CREATE POLICY "Users insert parsed_rows for owned source files"
ON public.parsed_rows
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'admin')
  OR EXISTS (
    SELECT 1 FROM public.source_files sf
    WHERE sf.id = parsed_rows.source_file_id
      AND (sf.uploaded_by = auth.uid()
           OR (sf.detected_company IS NOT NULL
               AND public.user_has_company_access(auth.uid(), sf.detected_company)))
  )
);

-- 4) Explicit restrictive default-deny on parsed_row_edits UPDATE/DELETE for non-admins
CREATE POLICY "Only admins can update parsed_row_edits"
ON public.parsed_row_edits
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Only admins can delete parsed_row_edits"
ON public.parsed_row_edits
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- 5) Explicit admin-only UPDATE/DELETE on upload_history for non-admin clarity
CREATE POLICY "Only admins can update upload_history"
ON public.upload_history
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Only admins can delete upload_history"
ON public.upload_history
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));
