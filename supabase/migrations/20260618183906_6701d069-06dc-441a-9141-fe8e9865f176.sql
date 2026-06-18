
-- Add unique constraint for upsert dedup
ALTER TABLE public.claims_raw ADD CONSTRAINT claims_raw_unique_line UNIQUE (acct, dos, cpt, company);

-- Upload history table
CREATE TABLE public.upload_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename text NOT NULL,
  company text NOT NULL,
  uploaded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  rows_processed integer NOT NULL DEFAULT 0,
  rows_inserted integer NOT NULL DEFAULT 0,
  rows_updated integer NOT NULL DEFAULT 0,
  rows_skipped integer NOT NULL DEFAULT 0,
  unknown_cpt_count integer NOT NULL DEFAULT 0,
  errors jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.upload_history TO authenticated;
GRANT ALL ON public.upload_history TO service_role;

ALTER TABLE public.upload_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all upload history" ON public.upload_history
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users see upload history for accessible companies" ON public.upload_history
  FOR SELECT TO authenticated
  USING (public.user_has_company_access(auth.uid(), company));

CREATE POLICY "Users insert upload history for accessible companies" ON public.upload_history
  FOR INSERT TO authenticated
  WITH CHECK (public.user_has_company_access(auth.uid(), company) AND uploaded_by = auth.uid());
