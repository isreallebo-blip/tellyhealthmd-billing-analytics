-- Fix realtime topic escalation: scope to caller's uid
DROP POLICY IF EXISTS "Users subscribe own notif topic" ON realtime.messages;
CREATE POLICY "Users subscribe own notif topic"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  realtime.topic() = ('notif:' || auth.uid()::text)
  OR realtime.topic() LIKE ('user:' || auth.uid()::text || ':%')
  OR realtime.topic() LIKE ('upload-jobs:' || auth.uid()::text || ':%')
);

-- Revoke anon/public EXECUTE on SECURITY DEFINER trigger function
REVOKE EXECUTE ON FUNCTION public.prevent_upload_jobs_escalation() FROM PUBLIC, anon, authenticated;