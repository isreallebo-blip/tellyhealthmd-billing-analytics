
-- Restrict alert_rules SELECT to admins only
DROP POLICY IF EXISTS "alert_rules_select" ON public.alert_rules;
DROP POLICY IF EXISTS "alert_rules_read" ON public.alert_rules;
DROP POLICY IF EXISTS "Authenticated can read alert rules" ON public.alert_rules;
CREATE POLICY "alert_rules_select_admin"
  ON public.alert_rules FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Restrict file_activity_log SELECT to admins only (it exposes actor emails)
DROP POLICY IF EXISTS "file_activity_log_select" ON public.file_activity_log;
DROP POLICY IF EXISTS "file_activity_log_read" ON public.file_activity_log;
DROP POLICY IF EXISTS "Authenticated can read file activity" ON public.file_activity_log;
CREATE POLICY "file_activity_log_select_admin"
  ON public.file_activity_log FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
