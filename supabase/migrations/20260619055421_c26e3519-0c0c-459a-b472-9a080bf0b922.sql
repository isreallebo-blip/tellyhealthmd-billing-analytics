
CREATE OR REPLACE FUNCTION public.log_source_file_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := COALESCE(auth.uid(),
                           CASE WHEN TG_OP = 'DELETE' THEN OLD.uploaded_by ELSE NEW.uploaded_by END);
  v_email text;
BEGIN
  SELECT email INTO v_email FROM public.profiles WHERE id = v_actor;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.file_activity_log(source_file_id, filename, action, actor_id, actor_email, detected_company, row_count)
    VALUES (NEW.id, NEW.filename, 'uploaded', v_actor, v_email, NEW.detected_company, NEW.row_count);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      INSERT INTO public.file_activity_log(source_file_id, filename, action, actor_id, actor_email, detected_company, row_count, details)
      VALUES (NEW.id, NEW.filename, NEW.status, v_actor, v_email, NEW.detected_company, NEW.row_count,
              jsonb_build_object('from', OLD.status, 'to', NEW.status));
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.file_activity_log(source_file_id, filename, action, actor_id, actor_email, detected_company, row_count)
    VALUES (OLD.id, OLD.filename, 'deleted', v_actor, v_email, OLD.detected_company, OLD.row_count);
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.log_source_file_activity() FROM PUBLIC, anon, authenticated;
