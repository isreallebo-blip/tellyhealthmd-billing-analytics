
REVOKE SELECT (file_bytes) ON public.source_files FROM authenticated, anon;
REVOKE SELECT (file_bytes) ON public.export_jobs FROM authenticated, anon;

GRANT SELECT (id, uploaded_by, filename, mime, size_bytes, sha256, detected_company, status, row_count, header_row, column_mapping, unmapped_columns, error, approved_by, approved_at, uploaded_at, updated_at, kind, mapping_template_id)
  ON public.source_files TO authenticated;

GRANT SELECT (id, requested_by, name, filters, status, row_count, filename, error, created_at, completed_at)
  ON public.export_jobs TO authenticated;

DROP POLICY IF EXISTS "Read accessible templates" ON public.mapping_templates;
CREATE POLICY "Read accessible templates"
  ON public.mapping_templates FOR SELECT
  TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR (match_company IS NOT NULL AND user_has_company_access(auth.uid(), match_company))
  );
