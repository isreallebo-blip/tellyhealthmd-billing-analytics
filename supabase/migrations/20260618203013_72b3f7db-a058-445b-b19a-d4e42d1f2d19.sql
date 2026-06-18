CREATE TABLE public.upload_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  filename text NOT NULL,
  company text,
  status text NOT NULL DEFAULT 'queued',
  total_rows integer NOT NULL DEFAULT 0,
  processed_rows integer NOT NULL DEFAULT 0,
  inserted integer NOT NULL DEFAULT 0,
  updated integer NOT NULL DEFAULT 0,
  skipped integer NOT NULL DEFAULT 0,
  unknown_cpt integer NOT NULL DEFAULT 0,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

GRANT SELECT, INSERT, UPDATE ON public.upload_jobs TO authenticated;
GRANT ALL ON public.upload_jobs TO service_role;

ALTER TABLE public.upload_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own upload jobs"
  ON public.upload_jobs FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users insert own upload jobs"
  ON public.upload_jobs FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users update own upload jobs"
  ON public.upload_jobs FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_upload_jobs_user_status ON public.upload_jobs(user_id, status, created_at DESC);

ALTER PUBLICATION supabase_realtime ADD TABLE public.upload_jobs;
ALTER TABLE public.upload_jobs REPLICA IDENTITY FULL;