
ALTER TABLE public.parsed_rows
  ADD COLUMN IF NOT EXISTS is_duplicate boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS duplicate_of_source_file_id uuid REFERENCES public.source_files(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS duplicate_key text;

CREATE INDEX IF NOT EXISTS parsed_rows_dup_key_idx ON public.parsed_rows(duplicate_key) WHERE duplicate_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS parsed_rows_is_duplicate_idx ON public.parsed_rows(source_file_id, is_duplicate);

-- Helper index on claims_raw for dedup lookups
CREATE INDEX IF NOT EXISTS claims_raw_dedup_idx
  ON public.claims_raw(acct, dos, cpt);

-- Flags duplicates within a source_file's parsed_rows against:
--   1) claims_raw rows already published from OTHER source files
--   2) earlier parsed rows in the same staging set (intra-file dedup)
CREATE OR REPLACE FUNCTION public.flag_duplicate_parsed_rows(_source_file_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  flagged integer;
BEGIN
  -- Compute duplicate_key for every parsed row in this source file
  UPDATE public.parsed_rows pr
  SET duplicate_key = lower(coalesce(pr.data->>'acct','') || '|' ||
                            coalesce(pr.data->>'dos','')  || '|' ||
                            coalesce(pr.data->>'cpt',''))
  WHERE pr.source_file_id = _source_file_id;

  -- Reset flags so a re-parse / re-run is idempotent
  UPDATE public.parsed_rows
  SET is_duplicate = false, duplicate_of_source_file_id = NULL
  WHERE source_file_id = _source_file_id;

  -- 1) Mark rows that already exist in claims_raw FROM A DIFFERENT source file
  WITH self AS (
    SELECT pr.id, pr.duplicate_key
    FROM public.parsed_rows pr
    WHERE pr.source_file_id = _source_file_id
      AND pr.duplicate_key IS NOT NULL
      AND pr.duplicate_key <> '||'
  ),
  hits AS (
    SELECT DISTINCT ON (self.id) self.id, cr.source_file_id
    FROM self
    JOIN public.claims_raw cr
      ON lower(coalesce(cr.acct,'') || '|' || coalesce(cr.dos::text,'') || '|' || coalesce(cr.cpt,''))
         = self.duplicate_key
    WHERE cr.source_file_id IS DISTINCT FROM _source_file_id
    ORDER BY self.id, cr.source_file_id NULLS LAST
  )
  UPDATE public.parsed_rows pr
  SET is_duplicate = true,
      duplicate_of_source_file_id = hits.source_file_id
  FROM hits
  WHERE pr.id = hits.id;

  -- 2) Intra-file dedup: keep first occurrence, flag the rest
  WITH ranked AS (
    SELECT id,
           row_number() OVER (PARTITION BY duplicate_key ORDER BY row_index) AS rn
    FROM public.parsed_rows
    WHERE source_file_id = _source_file_id
      AND duplicate_key IS NOT NULL
      AND duplicate_key <> '||'
      AND is_duplicate = false
  )
  UPDATE public.parsed_rows pr
  SET is_duplicate = true
  FROM ranked
  WHERE pr.id = ranked.id AND ranked.rn > 1;

  SELECT count(*) INTO flagged
  FROM public.parsed_rows
  WHERE source_file_id = _source_file_id AND is_duplicate = true;

  RETURN flagged;
END;
$$;

GRANT EXECUTE ON FUNCTION public.flag_duplicate_parsed_rows(uuid) TO authenticated, service_role;
