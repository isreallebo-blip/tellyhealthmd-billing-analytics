
-- File activity log: track upload, parse, approval, deletion events for source files
CREATE TABLE public.file_activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_file_id uuid,
  filename text NOT NULL,
  action text NOT NULL, -- uploaded | parsing | needs_review | approved | failed | reparsed | deleted
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email text,
  detected_company text,
  row_count integer,
  details jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX file_activity_log_created_idx ON public.file_activity_log(created_at DESC);
CREATE INDEX file_activity_log_file_idx ON public.file_activity_log(source_file_id);
CREATE INDEX file_activity_log_actor_idx ON public.file_activity_log(actor_id);

GRANT SELECT, INSERT ON public.file_activity_log TO authenticated;
GRANT ALL ON public.file_activity_log TO service_role;

ALTER TABLE public.file_activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated insert activity"
  ON public.file_activity_log FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "Admins read all activity"
  ON public.file_activity_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users read their own activity"
  ON public.file_activity_log FOR SELECT TO authenticated
  USING (actor_id = auth.uid());

-- Trigger: automatically log status changes / inserts / deletes on source_files
CREATE OR REPLACE FUNCTION public.log_source_file_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_email text;
BEGIN
  SELECT email INTO v_email FROM public.profiles WHERE id = v_actor;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.file_activity_log(source_file_id, filename, action, actor_id, actor_email, detected_company, row_count)
    VALUES (NEW.id, NEW.filename, 'uploaded', COALESCE(v_actor, NEW.uploaded_by), v_email, NEW.detected_company, NEW.row_count);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      INSERT INTO public.file_activity_log(source_file_id, filename, action, actor_id, actor_email, detected_company, row_count, details)
      VALUES (NEW.id, NEW.filename, NEW.status, COALESCE(v_actor, NEW.uploaded_by), v_email, NEW.detected_company, NEW.row_count,
              jsonb_build_object('from', OLD.status, 'to', NEW.status));
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.file_activity_log(source_file_id, filename, action, actor_id, actor_email, detected_company, row_count)
    VALUES (OLD.id, OLD.filename, 'deleted', COALESCE(v_actor, OLD.uploaded_by), v_email, OLD.detected_company, OLD.row_count);
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS source_files_activity_ins ON public.source_files;
DROP TRIGGER IF EXISTS source_files_activity_upd ON public.source_files;
DROP TRIGGER IF EXISTS source_files_activity_del ON public.source_files;

CREATE TRIGGER source_files_activity_ins
  AFTER INSERT ON public.source_files
  FOR EACH ROW EXECUTE FUNCTION public.log_source_file_activity();

CREATE TRIGGER source_files_activity_upd
  AFTER UPDATE ON public.source_files
  FOR EACH ROW EXECUTE FUNCTION public.log_source_file_activity();

CREATE TRIGGER source_files_activity_del
  AFTER DELETE ON public.source_files
  FOR EACH ROW EXECUTE FUNCTION public.log_source_file_activity();

-- Allow uploaders to delete their own files; admins delete any
DROP POLICY IF EXISTS "Users delete their own files" ON public.source_files;
CREATE POLICY "Users delete their own files"
  ON public.source_files FOR DELETE TO authenticated
  USING (uploaded_by = auth.uid() OR public.has_role(auth.uid(), 'admin'));
