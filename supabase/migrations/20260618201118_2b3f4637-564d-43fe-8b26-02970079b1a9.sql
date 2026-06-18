ALTER TABLE public.claims_raw
  ADD COLUMN IF NOT EXISTS upload_id uuid REFERENCES public.upload_history(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_updated_upload_id uuid REFERENCES public.upload_history(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS claims_raw_upload_id_idx ON public.claims_raw(upload_id);
CREATE INDEX IF NOT EXISTS claims_raw_last_updated_upload_id_idx ON public.claims_raw(last_updated_upload_id);