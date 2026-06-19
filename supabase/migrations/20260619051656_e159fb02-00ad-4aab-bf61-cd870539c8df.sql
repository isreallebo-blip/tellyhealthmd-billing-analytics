
DO $$ BEGIN
  CREATE TYPE public.alert_rule_type AS ENUM ('unpaid_over_days','denial_rate','no_revenue_days','large_balance');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.alert_severity AS ENUM ('info','warning','critical');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE public.alert_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  rule_type public.alert_rule_type NOT NULL,
  severity public.alert_severity NOT NULL DEFAULT 'warning',
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_evaluated_at timestamptz
);
GRANT SELECT ON public.alert_rules TO authenticated;
GRANT ALL ON public.alert_rules TO service_role;
ALTER TABLE public.alert_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read rules" ON public.alert_rules
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage rules" ON public.alert_rules
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER alert_rules_touch
  BEFORE UPDATE ON public.alert_rules
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rule_id uuid REFERENCES public.alert_rules(id) ON DELETE SET NULL,
  title text NOT NULL,
  body text,
  severity public.alert_severity NOT NULL DEFAULT 'info',
  link text,
  dedup_key text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_unread_idx ON public.notifications(user_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX notifications_user_created_idx ON public.notifications(user_id, created_at DESC);
CREATE INDEX notifications_dedup_lookup_idx ON public.notifications(user_id, rule_id, dedup_key, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own notifications" ON public.notifications
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users update own notifications" ON public.notifications
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own notifications" ON public.notifications
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

CREATE OR REPLACE FUNCTION public.evaluate_alert_rules()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  r record;
  cfg jsonb;
  total_created integer := 0;
  per_rule jsonb := '[]'::jsonb;
  created_now integer;
  recipients uuid[];
BEGIN
  SELECT coalesce(array_agg(id), ARRAY[]::uuid[]) INTO recipients
  FROM public.profiles WHERE role IN ('admin','analyst');

  IF recipients IS NULL OR array_length(recipients,1) IS NULL THEN
    RETURN jsonb_build_object('created', 0, 'note', 'no recipients');
  END IF;

  FOR r IN SELECT * FROM public.alert_rules WHERE is_active = true LOOP
    cfg := r.config;
    created_now := 0;

    IF r.rule_type = 'unpaid_over_days' THEN
      WITH agg AS (
        SELECT coalesce(c.pri_ins, '—') AS k, count(*)::int AS n
        FROM public.claims_raw c
        WHERE c.is_primary_billable = true
          AND (c.revenue IS NULL OR c.revenue = 0)
          AND c.dos IS NOT NULL
          AND (CURRENT_DATE - c.dos) > coalesce((cfg->>'threshold_days')::int, 30)
        GROUP BY 1
        HAVING count(*) >= coalesce((cfg->>'min_count')::int, 1)
      ),
      candidates AS (
        SELECT u AS user_id, agg.k AS dk, agg.n
        FROM agg CROSS JOIN unnest(recipients) AS u
      ),
      ins AS (
        INSERT INTO public.notifications(user_id, rule_id, title, body, severity, link, dedup_key)
        SELECT c.user_id, r.id, r.name,
               format('%s unpaid claims for %s past %s days',
                      c.n, c.dk, coalesce((cfg->>'threshold_days')::int, 30)),
               r.severity, '/claims', c.dk
        FROM candidates c
        WHERE NOT EXISTS (
          SELECT 1 FROM public.notifications n
          WHERE n.user_id = c.user_id AND n.rule_id = r.id AND n.dedup_key = c.dk
            AND n.created_at > now() - interval '24 hours'
        )
        RETURNING 1
      )
      SELECT count(*)::int INTO created_now FROM ins;

    ELSIF r.rule_type = 'denial_rate' THEN
      WITH agg AS (
        SELECT coalesce(c.pri_ins,'—') AS k,
               count(*) FILTER (WHERE c.denial)::numeric AS denials,
               count(*)::numeric AS total
        FROM public.claims_raw c
        WHERE c.is_primary_billable = true
          AND c.dos IS NOT NULL
          AND c.dos >= (CURRENT_DATE - (coalesce((cfg->>'lookback_days')::int, 30) || ' days')::interval)
        GROUP BY 1
        HAVING count(*) >= coalesce((cfg->>'min_count')::int, 10)
           AND (count(*) FILTER (WHERE c.denial)::numeric / nullif(count(*),0)) * 100
               >= coalesce((cfg->>'threshold_pct')::numeric, 15)
      ),
      candidates AS (
        SELECT u AS user_id, agg.k AS dk, agg.denials, agg.total
        FROM agg CROSS JOIN unnest(recipients) AS u
      ),
      ins AS (
        INSERT INTO public.notifications(user_id, rule_id, title, body, severity, link, dedup_key)
        SELECT c.user_id, r.id, r.name,
               format('%s denial rate %s%% (last %s days)',
                      c.dk,
                      round((c.denials/nullif(c.total,0))*100, 1),
                      coalesce((cfg->>'lookback_days')::int, 30)),
               r.severity, '/claims', c.dk
        FROM candidates c
        WHERE NOT EXISTS (
          SELECT 1 FROM public.notifications n
          WHERE n.user_id = c.user_id AND n.rule_id = r.id AND n.dedup_key = c.dk
            AND n.created_at > now() - interval '24 hours'
        )
        RETURNING 1
      )
      SELECT count(*)::int INTO created_now FROM ins;

    ELSIF r.rule_type = 'large_balance' THEN
      WITH agg AS (
        SELECT coalesce(c.prov_name,'—') AS k, count(*)::int AS n
        FROM public.claims_raw c
        WHERE c.is_primary_billable = true
          AND (c.revenue IS NULL OR c.revenue = 0)
        GROUP BY 1
        HAVING count(*) >= coalesce((cfg->>'min_claims')::int, 5)
      ),
      candidates AS (
        SELECT u AS user_id, agg.k AS dk, agg.n
        FROM agg CROSS JOIN unnest(recipients) AS u
      ),
      ins AS (
        INSERT INTO public.notifications(user_id, rule_id, title, body, severity, link, dedup_key)
        SELECT c.user_id, r.id, r.name,
               format('Provider %s has %s unpaid claims piling up', c.dk, c.n),
               r.severity, '/claims', c.dk
        FROM candidates c
        WHERE NOT EXISTS (
          SELECT 1 FROM public.notifications n
          WHERE n.user_id = c.user_id AND n.rule_id = r.id AND n.dedup_key = c.dk
            AND n.created_at > now() - interval '24 hours'
        )
        RETURNING 1
      )
      SELECT count(*)::int INTO created_now FROM ins;

    ELSIF r.rule_type = 'no_revenue_days' THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.claims_raw
        WHERE pay_date IS NOT NULL AND revenue IS NOT NULL AND revenue > 0
          AND pay_date >= (CURRENT_DATE - (coalesce((cfg->>'days')::int, 7) || ' days')::interval)
      ) THEN
        WITH candidates AS (
          SELECT u AS user_id FROM unnest(recipients) AS u
        ),
        ins AS (
          INSERT INTO public.notifications(user_id, rule_id, title, body, severity, link, dedup_key)
          SELECT c.user_id, r.id, r.name,
                 format('No payments recorded in the last %s days', coalesce((cfg->>'days')::int, 7)),
                 r.severity, '/', 'global'
          FROM candidates c
          WHERE NOT EXISTS (
            SELECT 1 FROM public.notifications n
            WHERE n.user_id = c.user_id AND n.rule_id = r.id AND n.dedup_key = 'global'
              AND n.created_at > now() - interval '24 hours'
          )
          RETURNING 1
        )
        SELECT count(*)::int INTO created_now FROM ins;
      END IF;
    END IF;

    UPDATE public.alert_rules SET last_evaluated_at = now() WHERE id = r.id;
    total_created := total_created + created_now;
    per_rule := per_rule || jsonb_build_object('rule', r.name, 'created', created_now);
  END LOOP;

  RETURN jsonb_build_object('created', total_created, 'rules', per_rule);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.evaluate_alert_rules() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.evaluate_alert_rules() TO service_role;
