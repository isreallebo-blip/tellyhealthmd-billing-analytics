ALTER TABLE public.claims_raw
  DROP CONSTRAINT IF EXISTS claims_raw_source_file_id_fkey;

ALTER TABLE public.claims_raw
  ADD CONSTRAINT claims_raw_source_file_id_fkey
  FOREIGN KEY (source_file_id)
  REFERENCES public.source_files(id)
  ON DELETE CASCADE;