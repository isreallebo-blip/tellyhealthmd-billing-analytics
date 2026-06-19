
-- 1) Revoke direct SELECT on export_jobs.file_bytes
REVOKE SELECT (file_bytes) ON public.export_jobs FROM authenticated;

-- 2) Restrict mapping_templates SELECT
DROP POLICY IF EXISTS "Authenticated read templates" ON public.mapping_templates;
CREATE POLICY "Read accessible templates" ON public.mapping_templates
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR match_company IS NULL
    OR user_has_company_access(auth.uid(), match_company)
  );

-- 3) Tighten parsed_row_edits INSERT to require source file access
DROP POLICY IF EXISTS "pre_insert" ON public.parsed_row_edits;
CREATE POLICY "pre_insert" ON public.parsed_row_edits
  FOR INSERT TO authenticated
  WITH CHECK (
    edited_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.source_files sf
      WHERE sf.id = parsed_row_edits.source_file_id
        AND (
          sf.uploaded_by = auth.uid()
          OR has_role(auth.uid(), 'admin'::app_role)
          OR (sf.detected_company IS NOT NULL
              AND user_has_company_access(auth.uid(), sf.detected_company))
        )
    )
  );
