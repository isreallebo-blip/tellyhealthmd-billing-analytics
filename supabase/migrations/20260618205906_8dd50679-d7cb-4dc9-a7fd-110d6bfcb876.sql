
CREATE OR REPLACE FUNCTION public.get_dashboard_stats(
  _companies text[] DEFAULT NULL,
  _providers text[] DEFAULT NULL,
  _insurances text[] DEFAULT NULL,
  _categories text[] DEFAULT NULL,
  _date_from date DEFAULT NULL,
  _date_to date DEFAULT NULL,
  _threshold integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  WITH filtered AS (
    SELECT
      c.acct, c.dos, c.cpt, c.pri_ins, c.prov_name, c.service_category,
      c.revenue, c.days_to_pmt, c.is_primary_billable,
      (c.revenue IS NOT NULL AND c.revenue > 0) AS is_paid,
      (COALESCE(c.is_primary_billable, false) AND (c.revenue IS NULL OR c.revenue = 0)) AS is_unpaid_pri
    FROM public.claims_raw c
    WHERE (_companies  IS NULL OR array_length(_companies,1)  IS NULL OR c.company         = ANY(_companies))
      AND (_providers  IS NULL OR array_length(_providers,1)  IS NULL OR c.prov_name       = ANY(_providers))
      AND (_insurances IS NULL OR array_length(_insurances,1) IS NULL OR c.pri_ins         = ANY(_insurances))
      AND (_categories IS NULL OR array_length(_categories,1) IS NULL OR c.service_category= ANY(_categories))
      AND (_date_from  IS NULL OR (c.dos IS NOT NULL AND c.dos >= _date_from))
      AND (_date_to    IS NULL OR (c.dos IS NOT NULL AND c.dos <= _date_to))
  ),
  kpi AS (
    SELECT
      count(*)::bigint AS total_lines,
      count(DISTINCT (COALESCE(acct,'') || '|' || COALESCE(dos::text,'') || '|' || COALESCE(service_category,'')))::bigint AS total_claims,
      count(*) FILTER (WHERE is_paid)::bigint AS paid,
      count(*) FILTER (WHERE is_unpaid_pri)::bigint AS unpaid,
      COALESCE(sum(revenue), 0)::numeric AS revenue,
      COALESCE(avg(days_to_pmt) FILTER (WHERE is_paid AND days_to_pmt > 0), 0)::numeric AS avg_days,
      count(*) FILTER (WHERE is_unpaid_pri AND dos IS NOT NULL AND (CURRENT_DATE - dos) > _threshold)::bigint AS past_threshold
    FROM filtered
  ),
  grp AS (
    SELECT 'insurance'::text AS g, COALESCE(pri_ins,'—') AS key,
      count(*)::bigint AS total,
      count(*) FILTER (WHERE is_paid)::bigint AS paid,
      count(*) FILTER (WHERE is_unpaid_pri)::bigint AS unpaid,
      COALESCE(sum(revenue),0)::numeric AS revenue,
      COALESCE(avg(days_to_pmt) FILTER (WHERE is_paid AND days_to_pmt > 0),0)::numeric AS avg_days,
      count(*) FILTER (WHERE is_unpaid_pri AND dos IS NOT NULL AND (CURRENT_DATE - dos) > _threshold)::bigint AS past_threshold
    FROM filtered GROUP BY 2
    UNION ALL
    SELECT 'provider', COALESCE(prov_name,'—'),
      count(*), count(*) FILTER (WHERE is_paid), count(*) FILTER (WHERE is_unpaid_pri),
      COALESCE(sum(revenue),0), COALESCE(avg(days_to_pmt) FILTER (WHERE is_paid AND days_to_pmt > 0),0),
      count(*) FILTER (WHERE is_unpaid_pri AND dos IS NOT NULL AND (CURRENT_DATE - dos) > _threshold)
    FROM filtered GROUP BY 2
    UNION ALL
    SELECT 'cpt', COALESCE(cpt,'—'),
      count(*), count(*) FILTER (WHERE is_paid), count(*) FILTER (WHERE is_unpaid_pri),
      COALESCE(sum(revenue),0), COALESCE(avg(days_to_pmt) FILTER (WHERE is_paid AND days_to_pmt > 0),0),
      count(*) FILTER (WHERE is_unpaid_pri AND dos IS NOT NULL AND (CURRENT_DATE - dos) > _threshold)
    FROM filtered GROUP BY 2
    UNION ALL
    SELECT 'category', COALESCE(service_category,'—'),
      count(*), count(*) FILTER (WHERE is_paid), count(*) FILTER (WHERE is_unpaid_pri),
      COALESCE(sum(revenue),0), COALESCE(avg(days_to_pmt) FILTER (WHERE is_paid AND days_to_pmt > 0),0),
      count(*) FILTER (WHERE is_unpaid_pri AND dos IS NOT NULL AND (CURRENT_DATE - dos) > _threshold)
    FROM filtered GROUP BY 2
    UNION ALL
    SELECT 'month', to_char(dos, 'YYYY-MM'),
      count(*), count(*) FILTER (WHERE is_paid), count(*) FILTER (WHERE is_unpaid_pri),
      COALESCE(sum(revenue),0), COALESCE(avg(days_to_pmt) FILTER (WHERE is_paid AND days_to_pmt > 0),0),
      count(*) FILTER (WHERE is_unpaid_pri AND dos IS NOT NULL AND (CURRENT_DATE - dos) > _threshold)
    FROM filtered WHERE dos IS NOT NULL GROUP BY 2
  ),
  grouped AS (
    SELECT g, jsonb_agg(jsonb_build_object(
      'key', key,
      'total', total,
      'paid', paid,
      'unpaid', unpaid,
      'unpaid_pct', CASE WHEN (paid + unpaid) > 0 THEN (unpaid::numeric / (paid + unpaid)) * 100 ELSE 0 END,
      'revenue', revenue,
      'avg_days', avg_days,
      'past_threshold', past_threshold
    )) AS arr
    FROM grp GROUP BY g
  )
  SELECT jsonb_build_object(
    'kpi', (SELECT to_jsonb(k) FROM kpi k),
    'by_insurance',        COALESCE((SELECT arr FROM grouped WHERE g='insurance'), '[]'::jsonb),
    'by_provider',         COALESCE((SELECT arr FROM grouped WHERE g='provider'),  '[]'::jsonb),
    'by_cpt',              COALESCE((SELECT arr FROM grouped WHERE g='cpt'),       '[]'::jsonb),
    'by_month',            COALESCE((SELECT arr FROM grouped WHERE g='month'),     '[]'::jsonb),
    'by_service_category', COALESCE((SELECT arr FROM grouped WHERE g='category'),  '[]'::jsonb)
  ) INTO result;
  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_dashboard_stats(text[], text[], text[], text[], date, date, integer) TO authenticated;
