
REVOKE EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.user_has_company_access(UUID, TEXT) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_company_access(UUID, TEXT) TO authenticated;
