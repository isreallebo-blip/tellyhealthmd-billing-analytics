
-- Fix privilege escalation: only admins can INSERT profiles (signups are handled
-- by the SECURITY DEFINER trigger handle_new_user which bypasses RLS).
DROP POLICY IF EXISTS "Admins can insert profiles" ON public.profiles;
CREATE POLICY "Admins can insert profiles"
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Restrict ai_training_instructions reads to admins only.
DROP POLICY IF EXISTS "Authenticated read AI instructions" ON public.ai_training_instructions;
CREATE POLICY "Admins read AI instructions"
  ON public.ai_training_instructions FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
