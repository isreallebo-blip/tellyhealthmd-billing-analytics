
CREATE TABLE public.ai_insights_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE UNIQUE,
  insights jsonb NOT NULL,
  stats_summary jsonb,
  model text,
  generated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_insights_runs TO authenticated;
GRANT ALL ON public.ai_insights_runs TO service_role;

ALTER TABLE public.ai_insights_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own insight runs" ON public.ai_insights_runs
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
