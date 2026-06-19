-- Revoke public/anon/authenticated EXECUTE on trigger-only SECURITY DEFINER functions
REVOKE EXECUTE ON FUNCTION public.evaluate_alert_rules() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.flag_duplicate_parsed_rows(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_source_file_activity() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prevent_profile_privilege_escalation() FROM PUBLIC, anon, authenticated;

-- Tighten file_activity_log INSERT policy: require actor_id = auth.uid()
DROP POLICY IF EXISTS "Authenticated insert own activity" ON public.file_activity_log;
CREATE POLICY "Authenticated insert own activity"
  ON public.file_activity_log
  FOR INSERT
  TO authenticated
  WITH CHECK (
    actor_id = auth.uid()
    AND lower(coalesce(actor_email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );