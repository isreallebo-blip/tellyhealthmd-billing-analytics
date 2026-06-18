
-- Roles enum
CREATE TYPE public.app_role AS ENUM ('admin', 'viewer');

-- Profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  role public.app_role NOT NULL DEFAULT 'viewer',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Security definer role check
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = _user_id AND role = _role
  )
$$;

CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT TO authenticated USING (id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE TO authenticated USING (id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can insert profiles" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin') OR id = auth.uid());
CREATE POLICY "Admins can delete profiles" ON public.profiles
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE((NEW.raw_user_meta_data->>'role')::public.app_role, 'viewer')
  );
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Company access
CREATE TABLE public.company_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  company_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, company_name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_access TO authenticated;
GRANT ALL ON public.company_access TO service_role;
ALTER TABLE public.company_access ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own access, admins view all" ON public.company_access
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins manage company access" ON public.company_access
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Helper: user has access to company
CREATE OR REPLACE FUNCTION public.user_has_company_access(_user_id UUID, _company TEXT)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.has_role(_user_id, 'admin') OR EXISTS (
    SELECT 1 FROM public.company_access
    WHERE user_id = _user_id AND company_name = _company
  )
$$;

-- Claims raw
CREATE TABLE public.claims_raw (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company TEXT NOT NULL,
  pt_name TEXT,
  dob DATE,
  pri_ins TEXT,
  prov_code TEXT,
  prov_name TEXT,
  dos DATE,
  cpt TEXT,
  avg_days_to_pmt NUMERIC,
  days_to_pmt NUMERIC,
  visit_type TEXT,
  revenue NUMERIC,
  pay_date DATE,
  denied_claim BOOLEAN DEFAULT false,
  mrn TEXT,
  acct TEXT,
  service_category TEXT,
  is_primary_billable BOOLEAN,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (acct, dos, cpt, company)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.claims_raw TO authenticated;
GRANT ALL ON public.claims_raw TO service_role;
ALTER TABLE public.claims_raw ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read claims for assigned companies" ON public.claims_raw
  FOR SELECT TO authenticated USING (public.user_has_company_access(auth.uid(), company));
CREATE POLICY "Admins manage claims" ON public.claims_raw
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_claims_company ON public.claims_raw(company);
CREATE INDEX idx_claims_dos ON public.claims_raw(dos);

-- CPT reference
CREATE TABLE public.cpt_reference (
  cpt_code TEXT PRIMARY KEY,
  description TEXT,
  service_category TEXT,
  billing_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.cpt_reference TO authenticated;
GRANT ALL ON public.cpt_reference TO service_role;
ALTER TABLE public.cpt_reference ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read CPT reference" ON public.cpt_reference
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage CPT reference" ON public.cpt_reference
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- CPT insurance overrides
CREATE TABLE public.cpt_insurance_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cpt_code TEXT NOT NULL,
  insurance_code TEXT NOT NULL,
  billing_type_override TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cpt_code, insurance_code)
);
GRANT SELECT ON public.cpt_insurance_overrides TO authenticated;
GRANT ALL ON public.cpt_insurance_overrides TO service_role;
ALTER TABLE public.cpt_insurance_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read overrides" ON public.cpt_insurance_overrides
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage overrides" ON public.cpt_insurance_overrides
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- AI training instructions
CREATE TABLE public.ai_training_instructions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instruction_text TEXT NOT NULL,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_training_instructions TO authenticated;
GRANT ALL ON public.ai_training_instructions TO service_role;
ALTER TABLE public.ai_training_instructions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read AI instructions" ON public.ai_training_instructions
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage AI instructions" ON public.ai_training_instructions
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Alert settings
CREATE TABLE public.alert_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  threshold_days INTEGER NOT NULL DEFAULT 30,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.alert_settings TO authenticated;
GRANT ALL ON public.alert_settings TO service_role;
ALTER TABLE public.alert_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own alert settings" ON public.alert_settings
  FOR ALL TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
