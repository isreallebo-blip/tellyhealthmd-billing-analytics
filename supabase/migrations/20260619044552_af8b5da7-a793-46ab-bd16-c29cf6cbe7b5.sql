
-- ============================================================================
-- Clinical Data Platform: source_files, parsed_rows, field_definitions
-- ============================================================================

-- 1. source_files — immutable record of every uploaded file + original bytes
CREATE TABLE public.source_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uploaded_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime TEXT,
  size_bytes BIGINT NOT NULL DEFAULT 0,
  sha256 TEXT,
  file_bytes BYTEA,                              -- original file, immutable
  detected_company TEXT,                          -- first non-empty Company value seen
  status TEXT NOT NULL DEFAULT 'queued',          -- queued | parsing | needs_review | approved | failed
  row_count INTEGER NOT NULL DEFAULT 0,
  header_row INTEGER,                             -- 0-based index of detected header row
  column_mapping JSONB,                           -- { "Pt Name": {field:"pt_name", confidence:1.0}, ... }
  unmapped_columns JSONB,                         -- ["Some Unknown Col", ...]
  error TEXT,
  approved_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMPTZ,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_source_files_uploader ON public.source_files(uploaded_by, uploaded_at DESC);
CREATE INDEX idx_source_files_status   ON public.source_files(status);
CREATE INDEX idx_source_files_company  ON public.source_files(detected_company);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.source_files TO authenticated;
GRANT ALL ON public.source_files TO service_role;
ALTER TABLE public.source_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "source_files_select" ON public.source_files FOR SELECT TO authenticated
  USING (
    uploaded_by = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR (detected_company IS NOT NULL AND public.user_has_company_access(auth.uid(), detected_company))
  );
CREATE POLICY "source_files_insert" ON public.source_files FOR INSERT TO authenticated
  WITH CHECK (uploaded_by = auth.uid());
CREATE POLICY "source_files_update" ON public.source_files FOR UPDATE TO authenticated
  USING (uploaded_by = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (uploaded_by = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "source_files_delete" ON public.source_files FOR DELETE TO authenticated
  USING (uploaded_by = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- 2. field_definitions — dynamic registry (no hardcoded fields in app logic)
CREATE TABLE public.field_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  field_key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  data_type TEXT NOT NULL,                       -- text | date | number | bool | cpt | icd10
  validation_regex TEXT,
  synonyms TEXT[] NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.field_definitions TO authenticated;
GRANT ALL ON public.field_definitions TO service_role;
ALTER TABLE public.field_definitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fd_select_auth"  ON public.field_definitions FOR SELECT TO authenticated USING (true);
CREATE POLICY "fd_admin_write"  ON public.field_definitions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.field_definitions (field_key, label, data_type, validation_regex, synonyms, display_order) VALUES
  ('company',       'Company',        'text',  NULL, ARRAY['company','client','practice','group'], 10),
  ('pt_name',       'Patient Name',   'text',  NULL, ARRAY['pt name','patient','patient name','client name','pt'], 20),
  ('mrn',           'MRN',            'text',  NULL, ARRAY['mrn','medical record number','chart','chart number'], 30),
  ('acct',          'Account #',      'text',  NULL, ARRAY['acct','account','account #','account number','encounter id'], 40),
  ('dob',           'DOB',            'date',  NULL, ARRAY['dob','date of birth','birthdate','birth date'], 50),
  ('dos',           'Date of Service','date',  NULL, ARRAY['dos','date of service','service date','visit date','encounter date'], 60),
  ('cpt',           'CPT Code',       'cpt',   '^[0-9A-Z]{5}$', ARRAY['cpt','cpt code','procedure code','procedure'], 70),
  ('pri_ins',       'Primary Insurance','text', NULL, ARRAY['pri_ins','primary insurance','insurance','payer','payor','primary payer'], 80),
  ('prov_code',     'Provider Code',  'text',  NULL, ARRAY['prov','provider code','rendering provider id','npi'], 90),
  ('prov_name',     'Provider Name',  'text',  NULL, ARRAY['prov name','provider','provider name','rendering provider','clinician'], 100),
  ('visit_type',    'Visit Type',     'text',  NULL, ARRAY['visit type','appointment type','encounter type','service type'], 110),
  ('revenue',       'Revenue',        'number',NULL, ARRAY['revenue','paid','payment','amount paid','collected'], 120),
  ('paydate',       'Payment Date',   'date',  NULL, ARRAY['paydate','pay date','payment date','date paid'], 130),
  ('days_to_pmt',   'Days to Payment','number',NULL, ARRAY['daystopmt','days to payment','days to pmt'], 140),
  ('avg_days_to_pmt','Avg Days to Pmt','number',NULL,ARRAY['avgdstopmt','avg days to pmt','average days to pmt'], 150),
  ('denied_claim',  'Denied',         'bool',  NULL, ARRAY['denied claim','denied','denial'], 160),
  ('icd10',         'ICD-10',         'icd10', '^[A-TV-Z][0-9][0-9A-Z](\.[0-9A-Z]{1,4})?$', ARRAY['icd','icd-10','diagnosis','dx','dx code'], 170),
  ('referrer',      'Referrer',       'text',  NULL, ARRAY['referrer','referring provider','referral source'], 180),
  ('facility',      'Facility',       'text',  NULL, ARRAY['facility','location','site','place of service','pos'], 190);

-- 3. parsed_rows — staging area between parse and approval
CREATE TABLE public.parsed_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_file_id UUID NOT NULL REFERENCES public.source_files(id) ON DELETE CASCADE,
  row_index INTEGER NOT NULL,                    -- 0-based, position in original sheet (after header)
  source_sheet TEXT,
  source_row INTEGER,                            -- 1-based row number in original file
  data JSONB NOT NULL DEFAULT '{}'::jsonb,        -- { field_key: normalized_value }
  raw_data JSONB,                                -- original cell values for the row (debug + edit revert)
  confidence JSONB NOT NULL DEFAULT '{}'::jsonb, -- { field_key: 0..1 }
  validation_errors JSONB NOT NULL DEFAULT '{}'::jsonb, -- { field_key: "reason" }
  edited BOOLEAN NOT NULL DEFAULT false,
  edited_by UUID REFERENCES auth.users(id),
  edited_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_parsed_rows_file ON public.parsed_rows(source_file_id, row_index);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.parsed_rows TO authenticated;
GRANT ALL ON public.parsed_rows TO service_role;
ALTER TABLE public.parsed_rows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pr_select" ON public.parsed_rows FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.source_files sf WHERE sf.id = source_file_id
    AND (sf.uploaded_by = auth.uid() OR public.has_role(auth.uid(),'admin')
         OR (sf.detected_company IS NOT NULL AND public.user_has_company_access(auth.uid(), sf.detected_company)))));
CREATE POLICY "pr_update" ON public.parsed_rows FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.source_files sf WHERE sf.id = source_file_id
    AND (sf.uploaded_by = auth.uid() OR public.has_role(auth.uid(),'admin'))));
CREATE POLICY "pr_delete" ON public.parsed_rows FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.source_files sf WHERE sf.id = source_file_id
    AND (sf.uploaded_by = auth.uid() OR public.has_role(auth.uid(),'admin'))));
-- inserts only via service_role (edge function) — no INSERT policy for authenticated

-- 4. parsed_row_edits — audit trail of manual corrections
CREATE TABLE public.parsed_row_edits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parsed_row_id UUID NOT NULL REFERENCES public.parsed_rows(id) ON DELETE CASCADE,
  source_file_id UUID NOT NULL REFERENCES public.source_files(id) ON DELETE CASCADE,
  field_key TEXT NOT NULL,
  old_value JSONB,
  new_value JSONB,
  edited_by UUID NOT NULL REFERENCES auth.users(id),
  edited_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_pre_file ON public.parsed_row_edits(source_file_id, edited_at DESC);
GRANT SELECT, INSERT ON public.parsed_row_edits TO authenticated;
GRANT ALL ON public.parsed_row_edits TO service_role;
ALTER TABLE public.parsed_row_edits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pre_select" ON public.parsed_row_edits FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.source_files sf WHERE sf.id = source_file_id
    AND (sf.uploaded_by = auth.uid() OR public.has_role(auth.uid(),'admin')
         OR (sf.detected_company IS NOT NULL AND public.user_has_company_access(auth.uid(), sf.detected_company)))));
CREATE POLICY "pre_insert" ON public.parsed_row_edits FOR INSERT TO authenticated
  WITH CHECK (edited_by = auth.uid());

-- 5. claims_raw lineage
ALTER TABLE public.claims_raw ADD COLUMN IF NOT EXISTS source_file_id UUID REFERENCES public.source_files(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_claims_source_file ON public.claims_raw(source_file_id);

-- 6. updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TRIGGER trg_source_files_touch BEFORE UPDATE ON public.source_files
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_field_definitions_touch BEFORE UPDATE ON public.field_definitions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 7. Realtime for live status updates on the files list and review screen
ALTER PUBLICATION supabase_realtime ADD TABLE public.source_files;
ALTER PUBLICATION supabase_realtime ADD TABLE public.parsed_rows;
