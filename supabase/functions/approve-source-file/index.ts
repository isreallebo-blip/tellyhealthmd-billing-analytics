// Edge function: approve-source-file
// Copies parsed_rows (with any manual edits) into claims_raw, linked back via source_file_id.
// Re-approve is idempotent: prior claims_raw rows for the file are deleted and re-inserted.

// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const PUBLISHABLE_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;

function collectSecretCandidates(v: unknown, out: string[] = []): string[] {
  if (!v) return out;
  if (typeof v === "string") {
    const t = v.trim(); if (!t) return out;
    try { collectSecretCandidates(JSON.parse(t), out); } catch {}
    out.push(t);
    t.split(/[\n,]/).map((p) => p.trim()).filter(Boolean).forEach((p) => out.push(p));
    return out;
  }
  if (Array.isArray(v)) v.forEach((i) => collectSecretCandidates(i, out));
  else if (typeof v === "object") Object.values(v).forEach((i) => collectSecretCandidates(i, out));
  return out;
}
function jwtRole(t: string): string | null {
  if (t.split(".").length !== 3) return null;
  try { return JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")))?.role ?? null; }
  catch { return null; }
}
function getServiceRoleKey(): string | null {
  const c = [
    ...collectSecretCandidates(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")),
    ...collectSecretCandidates(Deno.env.get("SUPABASE_SECRET_KEY")),
    ...collectSecretCandidates(Deno.env.get("SUPABASE_SECRET_KEYS")),
  ];
  return c.find((k) => jwtRole(k) === "service_role") ?? null;
}
function adminClient() {
  const k = getServiceRoleKey();
  if (k) return createClient(SUPABASE_URL, k, { auth: { persistSession: false } });
  return createClient(SUPABASE_URL, PUBLISHABLE_KEY, { auth: { persistSession: false } });
}

const BATCH = 500;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: corsHeaders });
  }
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
      global: { headers: { Authorization: authHeader } }, auth: { persistSession: false },
    });
    const { data: ud, error: uerr } = await userClient.auth.getUser();
    if (uerr || !ud?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }
    const userId = ud.user.id;

    const { source_file_id } = await req.json();
    if (!source_file_id) {
      return new Response(JSON.stringify({ error: "source_file_id required" }), { status: 400, headers: corsHeaders });
    }

    const db = adminClient();

    // Verify the caller can update this file (uses RLS via userClient)
    const { data: sf, error: sfErr } = await userClient
      .from("source_files").select("id,filename,detected_company,uploaded_by").eq("id", source_file_id).maybeSingle();
    if (sfErr || !sf) {
      return new Response(JSON.stringify({ error: "Not found or no access" }), { status: 404, headers: corsHeaders });
    }

    // Wipe previous claims_raw for this source file (re-approval path)
    await db.from("claims_raw").delete().eq("source_file_id", source_file_id);

    // Re-run dedup against the latest claims_raw before approving
    await db.rpc("flag_duplicate_parsed_rows", { _source_file_id: source_file_id });

    // Lookup tables (same as old process-upload)
    const [{ data: cptRef }, { data: overrides }] = await Promise.all([
      db.from("cpt_reference").select("cpt_code,service_category,billing_type"),
      db.from("cpt_insurance_overrides").select("cpt_code,insurance_code,billing_type_override"),
    ]);
    const cptMap = new Map<string, { service_category: string | null; billing_type: string | null }>();
    cptRef?.forEach((r: any) =>
      cptMap.set(String(r.cpt_code).toUpperCase(), { service_category: r.service_category, billing_type: r.billing_type })
    );
    const overrideMap = new Map<string, string>();
    overrides?.forEach((r: any) =>
      overrideMap.set(`${String(r.cpt_code).toUpperCase()}|${String(r.insurance_code).toUpperCase()}`, r.billing_type_override)
    );

    // Page parsed_rows — skip duplicates
    let inserted = 0, skipped = 0, dupSkipped = 0;
    const PAGE = 1000;
    let from = 0;
    while (true) {
      const { data: page, error: pErr } = await db
        .from("parsed_rows")
        .select("data,is_duplicate")
        .eq("source_file_id", source_file_id)
        .order("row_index", { ascending: true })
        .range(from, from + PAGE - 1);
      if (pErr) throw pErr;
      if (!page || page.length === 0) break;


      const toInsert: Record<string, any>[] = [];
      for (const r of page) {
        if ((r as any).is_duplicate) { dupSkipped++; continue; }
        const d = (r.data ?? {}) as Record<string, any>;
        const acct = d.acct ?? null;
        const dos = d.dos ?? null;
        const cpt = d.cpt ? String(d.cpt).toUpperCase() : null;
        const company = d.company ?? sf.detected_company ?? null;
        if (!acct || !dos || !cpt || !company) { skipped++; continue; }


        const ref = cptMap.get(cpt);
        let billing_type = ref?.billing_type ?? null;
        const service_category = ref?.service_category ?? null;
        const pri_ins = d.pri_ins ? String(d.pri_ins).toUpperCase() : null;
        const ov = pri_ins ? overrideMap.get(`${cpt}|${pri_ins}`) : undefined;
        if (ov) billing_type = ov;
        const is_primary_billable = ref ? billing_type === "Primary" : true;

        toInsert.push({
          company,
          pt_name: d.pt_name ?? null,
          dob: d.dob ?? null,
          pri_ins,
          prov_code: d.prov_code ?? null,
          prov_name: d.prov_name ?? null,
          dos, cpt,
          avg_days_to_pmt: d.avg_days_to_pmt ?? null,
          days_to_pmt: d.days_to_pmt ?? null,
          visit_type: d.visit_type ?? null,
          revenue: d.revenue ?? null,
          pay_date: d.paydate ?? null,
          denied_claim: d.denied_claim ?? false,
          mrn: d.mrn ?? null,
          acct,
          service_category,
          is_primary_billable,
          source_file_id,
        });
      }
      for (let i = 0; i < toInsert.length; i += BATCH) {
        const chunk = toInsert.slice(i, i + BATCH);
        const { error: iErr } = await db.from("claims_raw").insert(chunk);
        if (iErr) throw iErr;
        inserted += chunk.length;
      }
      if (page.length < PAGE) break;
      from += PAGE;
    }

    await db.from("source_files").update({
      status: "approved",
      approved_by: userId,
      approved_at: new Date().toISOString(),
    }).eq("id", source_file_id);

    return new Response(JSON.stringify({ inserted, skipped, duplicates_skipped: dupSkipped }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("approve-source-file failed", err);
    return new Response(JSON.stringify({ error: err?.message ?? "Unexpected error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
