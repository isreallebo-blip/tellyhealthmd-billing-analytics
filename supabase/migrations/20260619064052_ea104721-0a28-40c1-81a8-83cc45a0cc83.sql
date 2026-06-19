
-- Faster dedup: join via indexed columns instead of a synthetic string key.
CREATE OR REPLACE FUNCTION public.flag_duplicate_parsed_rows(_source_file_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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

  -- Reset flags so a re-parse is idempotent
  UPDATE public.parsed_rows
  SET is_duplicate = false, duplicate_of_source_file_id = NULL
  WHERE source_file_id = _source_file_id;

  -- 1) Cross-file dups: join via indexed (acct, dos, cpt) columns.
  WITH self AS (
    SELECT pr.id,
           lower(coalesce(pr.data->>'acct','')) AS acct,
           NULLIF(pr.data->>'dos','')::date     AS dos,
           lower(coalesce(pr.data->>'cpt',''))  AS cpt
    FROM public.parsed_rows pr
    WHERE pr.source_file_id = _source_file_id
      AND coalesce(pr.data->>'acct','') <> ''
      AND coalesce(pr.data->>'dos','')  <> ''
      AND coalesce(pr.data->>'cpt','')  <> ''
  ),
  hits AS (
    SELECT DISTINCT ON (s.id) s.id, cr.source_file_id
    FROM self s
    JOIN public.claims_raw cr
      ON lower(cr.acct) = s.acct
     AND cr.dos         = s.dos
     AND lower(cr.cpt)  = s.cpt
    WHERE cr.source_file_id IS DISTINCT FROM _source_file_id
    ORDER BY s.id, cr.source_file_id NULLS LAST
  )
  UPDATE public.parsed_rows pr
  SET is_duplicate = true,
      duplicate_of_source_file_id = hits.source_file_id
  FROM hits
  WHERE pr.id = hits.id;

  -- 2) Intra-file dedup
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

REVOKE EXECUTE ON FUNCTION public.flag_duplicate_parsed_rows(uuid) FROM PUBLIC, anon, authenticated;

-- Free uploads stuck in 'parsing' for more than 10 minutes (background task died)
UPDATE public.source_files
SET status = 'failed',
    error = COALESCE(error, 'Parsing timed out — retry the upload')
WHERE status = 'parsing'
  AND uploaded_at < now() - interval '10 minutes';
