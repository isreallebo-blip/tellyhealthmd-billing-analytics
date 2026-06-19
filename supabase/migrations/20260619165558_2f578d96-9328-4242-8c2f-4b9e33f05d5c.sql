-- Remove permissive SELECT policy on alert_rules, keep admin-only
DROP POLICY IF EXISTS "Authenticated read rules" ON public.alert_rules;
DROP POLICY IF EXISTS "alert_rules_read" ON public.alert_rules;
DROP POLICY IF EXISTS "alert_rules_select" ON public.alert_rules;

-- Remove duplicate DELETE policy on source_files
DROP POLICY IF EXISTS "Users delete their own files" ON public.source_files;
