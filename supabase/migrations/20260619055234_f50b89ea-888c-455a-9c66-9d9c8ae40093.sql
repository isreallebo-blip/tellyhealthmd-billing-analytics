
DROP POLICY IF EXISTS "Authenticated insert activity" ON public.file_activity_log;
CREATE POLICY "Authenticated insert own activity"
  ON public.file_activity_log FOR INSERT TO authenticated
  WITH CHECK (actor_id IS NULL OR actor_id = auth.uid());

REVOKE EXECUTE ON FUNCTION public.log_source_file_activity() FROM PUBLIC, anon, authenticated;
