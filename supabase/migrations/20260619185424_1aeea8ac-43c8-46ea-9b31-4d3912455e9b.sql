
-- 1) Prevent non-admin privilege escalation on upload_jobs
CREATE OR REPLACE FUNCTION public.prevent_upload_jobs_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;
  -- Non-admins can only edit benign metadata; backend-controlled fields stay locked.
  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.company IS DISTINCT FROM OLD.company
     OR NEW.total_rows IS DISTINCT FROM OLD.total_rows
     OR NEW.processed_rows IS DISTINCT FROM OLD.processed_rows
     OR NEW.inserted IS DISTINCT FROM OLD.inserted
     OR NEW.updated IS DISTINCT FROM OLD.updated
     OR NEW.skipped IS DISTINCT FROM OLD.skipped
     OR NEW.unknown_cpt IS DISTINCT FROM OLD.unknown_cpt
     OR NEW.error_message IS DISTINCT FROM OLD.error_message
     OR NEW.completed_at IS DISTINCT FROM OLD.completed_at
  THEN
    RAISE EXCEPTION 'Only admins or backend processes can change upload job status/progress fields';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS upload_jobs_prevent_escalation ON public.upload_jobs;
CREATE TRIGGER upload_jobs_prevent_escalation
BEFORE UPDATE ON public.upload_jobs
FOR EACH ROW
EXECUTE FUNCTION public.prevent_upload_jobs_escalation();

-- Tighten WITH CHECK so user_id cannot be reassigned to another user
DROP POLICY IF EXISTS "Users update own upload jobs" ON public.upload_jobs;
CREATE POLICY "Users update own upload jobs"
ON public.upload_jobs
FOR UPDATE
TO authenticated
USING ((user_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role))
WITH CHECK ((user_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));

-- 2) Realtime channel authorization for notif-<user_id> topics
-- Restrict authenticated users to only subscribe to their own notif-* topic.
DROP POLICY IF EXISTS "Users subscribe own notif topic" ON realtime.messages;
CREATE POLICY "Users subscribe own notif topic"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  realtime.topic() = ('notif-' || auth.uid()::text)
  OR realtime.topic() = ('notif-page-' || auth.uid()::text)
  OR realtime.topic() LIKE 'user:%'
  OR realtime.topic() LIKE 'upload-jobs:%'
);
