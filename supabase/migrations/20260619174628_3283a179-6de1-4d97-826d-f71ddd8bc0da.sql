CREATE POLICY "Users read claims from uploaded approved files"
  ON public.claims_raw
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.source_files sf
      WHERE sf.id = claims_raw.source_file_id
        AND sf.uploaded_by = auth.uid()
    )
    OR (
      claims_raw.source_file_id IS NULL
      AND EXISTS (
        SELECT 1
        FROM public.source_files sf
        WHERE sf.uploaded_by = auth.uid()
          AND sf.status = 'approved'
          AND sf.detected_company = claims_raw.company
      )
    )
  );