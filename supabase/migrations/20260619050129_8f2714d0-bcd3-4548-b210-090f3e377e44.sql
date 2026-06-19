
ALTER TABLE public.source_files
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'structured'
  CHECK (kind IN ('structured', 'unstructured'));
