CREATE INDEX idx_claims_pri_ins ON public.claims_raw(pri_ins);
CREATE INDEX idx_claims_prov_name ON public.claims_raw(prov_name);
CREATE INDEX idx_claims_is_primary_billable ON public.claims_raw(is_primary_billable);
CREATE INDEX idx_claims_revenue ON public.claims_raw(revenue);
CREATE INDEX idx_claims_dos_company ON public.claims_raw(dos, company);