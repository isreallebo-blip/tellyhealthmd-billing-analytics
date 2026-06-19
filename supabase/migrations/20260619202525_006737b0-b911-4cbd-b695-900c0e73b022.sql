CREATE OR REPLACE FUNCTION public.link_legacy_claims_to_source_file(_source_file_id uuid)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  linked_count integer := 0;
BEGIN
  WITH sf AS (
    SELECT id, detected_company
    FROM public.source_files
    WHERE id = _source_file_id
  ), parsed_keys AS (
    SELECT DISTINCT
      lower(trim(pr.data->>'acct')) AS acct_key,
      CASE
        WHEN pr.data->>'dos' ~ '^\d{4}-\d{2}-\d{2}$' THEN (pr.data->>'dos')::date
        ELSE NULL::date
      END AS dos_key,
      upper(trim(pr.data->>'cpt')) AS cpt_key,
      COALESCE(NULLIF(trim(pr.data->>'company'), ''), sf.detected_company) AS company_key
    FROM public.parsed_rows pr
    JOIN sf ON sf.id = pr.source_file_id
    WHERE pr.source_file_id = _source_file_id
      AND COALESCE(trim(pr.data->>'acct'), '') <> ''
      AND COALESCE(trim(pr.data->>'dos'), '') <> ''
      AND COALESCE(trim(pr.data->>'cpt'), '') <> ''
      AND COALESCE(NULLIF(trim(pr.data->>'company'), ''), sf.detected_company) IS NOT NULL
  )
  UPDATE public.claims_raw c
  SET source_file_id = _source_file_id
  FROM parsed_keys pk
  WHERE c.source_file_id IS NULL
    AND lower(trim(COALESCE(c.acct, ''))) = pk.acct_key
    AND c.dos = pk.dos_key
    AND upper(trim(COALESCE(c.cpt, ''))) = pk.cpt_key
    AND c.company = pk.company_key;

  GET DIAGNOSTICS linked_count = ROW_COUNT;
  RETURN linked_count;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.link_legacy_claims_to_source_file(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.link_legacy_claims_to_source_file(uuid) TO service_role;