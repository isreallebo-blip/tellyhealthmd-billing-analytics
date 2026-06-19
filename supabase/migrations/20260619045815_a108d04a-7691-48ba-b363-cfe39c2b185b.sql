
REVOKE ALL ON FUNCTION public.flag_duplicate_parsed_rows(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.flag_duplicate_parsed_rows(uuid) TO service_role;
