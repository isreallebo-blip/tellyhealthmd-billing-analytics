ALTER TABLE public.upload_history
  ADD COLUMN IF NOT EXISTS skipped_rows jsonb,
  ADD COLUMN IF NOT EXISTS unknown_cpts jsonb;