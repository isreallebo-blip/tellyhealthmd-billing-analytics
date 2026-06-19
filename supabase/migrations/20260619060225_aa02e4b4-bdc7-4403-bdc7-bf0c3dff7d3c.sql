
-- 1) file_activity_log: prevent spoofing actor_email
DROP POLICY IF EXISTS "Authenticated insert own activity" ON public.file_activity_log;

CREATE POLICY "Authenticated insert own activity"
ON public.file_activity_log
FOR INSERT
TO authenticated
WITH CHECK (
  ((actor_id IS NULL) OR (actor_id = auth.uid()))
  AND (
    actor_email IS NULL
    OR lower(actor_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
);

-- 2) profiles: block non-admins from changing role or is_active via a trigger
CREATE OR REPLACE FUNCTION public.prevent_profile_privilege_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Allow admins to change anything
  IF public.has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;

  -- Non-admins (including the row owner) cannot change role or is_active
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'Only admins can change role';
  END IF;
  IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    RAISE EXCEPTION 'Only admins can change active status';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_prevent_privilege_escalation ON public.profiles;
CREATE TRIGGER profiles_prevent_privilege_escalation
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.prevent_profile_privilege_escalation();
