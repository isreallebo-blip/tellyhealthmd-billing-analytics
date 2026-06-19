
-- 1) PHI access audit log
CREATE TABLE public.phi_access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action text NOT NULL,
  target_table text,
  target_id text,
  source_file_id uuid,
  row_count integer,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX phi_access_log_user_idx ON public.phi_access_log(user_id, created_at DESC);
CREATE INDEX phi_access_log_action_idx ON public.phi_access_log(action, created_at DESC);
GRANT SELECT, INSERT ON public.phi_access_log TO authenticated;
GRANT ALL ON public.phi_access_log TO service_role;
ALTER TABLE public.phi_access_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users insert their own access entries"
  ON public.phi_access_log FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins read access log"
  ON public.phi_access_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 2) Mapping templates
CREATE TABLE public.mapping_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  match_company text,
  match_filename_pattern text,
  mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mapping_templates_active_idx ON public.mapping_templates(is_active, priority DESC);
GRANT SELECT ON public.mapping_templates TO authenticated;
GRANT ALL ON public.mapping_templates TO service_role;
ALTER TABLE public.mapping_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read templates"
  ON public.mapping_templates FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage templates"
  ON public.mapping_templates FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER mapping_templates_touch
  BEFORE UPDATE ON public.mapping_templates
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Track which template was applied to a source file
ALTER TABLE public.source_files
  ADD COLUMN IF NOT EXISTS mapping_template_id uuid REFERENCES public.mapping_templates(id) ON DELETE SET NULL;

-- 3) Export jobs
CREATE TABLE public.export_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued',
  row_count integer,
  file_bytes bytea,
  filename text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX export_jobs_requested_by_idx ON public.export_jobs(requested_by, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.export_jobs TO authenticated;
GRANT ALL ON public.export_jobs TO service_role;
ALTER TABLE public.export_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own export jobs"
  ON public.export_jobs FOR SELECT TO authenticated
  USING (auth.uid() = requested_by OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users create own export jobs"
  ON public.export_jobs FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = requested_by);
CREATE POLICY "Users delete own export jobs"
  ON public.export_jobs FOR DELETE TO authenticated
  USING (auth.uid() = requested_by OR public.has_role(auth.uid(), 'admin'));
