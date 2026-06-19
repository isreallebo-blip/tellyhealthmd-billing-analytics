
-- 1) Block direct SELECT on export_jobs.file_bytes; users must use download_export_job() audited function.
REVOKE SELECT (file_bytes) ON public.export_jobs FROM authenticated;

-- 2) Tighten parsed_rows INSERT to uploader or admin only (remove company-access write path).
DROP POLICY IF EXISTS "Users insert parsed_rows for owned source files" ON public.parsed_rows;
CREATE POLICY "Users insert parsed_rows for owned source files"
ON public.parsed_rows
FOR INSERT
TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  OR EXISTS (
    SELECT 1 FROM public.source_files sf
    WHERE sf.id = parsed_rows.source_file_id
      AND sf.uploaded_by = auth.uid()
  )
);
