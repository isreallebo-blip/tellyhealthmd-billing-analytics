
-- 1. cpt_insurance_overrides: admins only
DROP POLICY IF EXISTS "Authenticated read overrides" ON public.cpt_insurance_overrides;
CREATE POLICY "Admins read overrides"
  ON public.cpt_insurance_overrides
  FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- 2. profiles: prevent role escalation by non-admins
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

CREATE POLICY "Users update own profile non-role"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND role = (SELECT role FROM public.profiles WHERE id = auth.uid())
    AND is_active = (SELECT is_active FROM public.profiles WHERE id = auth.uid())
  );

CREATE POLICY "Admins update any profile"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- 3. realtime.messages: restrict broadcast/presence channel subscriptions
-- Only allow users to subscribe to channels scoped to their own user id
-- (postgres_changes replication is unaffected; it respects RLS on source tables.)
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users own channels only" ON realtime.messages;
CREATE POLICY "Authenticated users own channels only"
  ON realtime.messages
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND (
      topic LIKE ('user:' || auth.uid()::text || ':%')
      OR topic LIKE ('upload-jobs:' || auth.uid()::text || ':%')
    )
  );

DROP POLICY IF EXISTS "Authenticated users own channels insert" ON realtime.messages;
CREATE POLICY "Authenticated users own channels insert"
  ON realtime.messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND (
      topic LIKE ('user:' || auth.uid()::text || ':%')
      OR topic LIKE ('upload-jobs:' || auth.uid()::text || ':%')
    )
  );
