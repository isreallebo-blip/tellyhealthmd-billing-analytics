// @ts-nocheck
// Async export: builds a CSV of filtered claims_raw rows and stores bytes in export_jobs.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const PUBLISHABLE_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;

function collectSecretCandidates(value: unknown, out: string[] = []): string[] {
  if (!value) return out;
  if (typeof value === "string") {
    const t = value.trim(); if (!t) return out;
    try { collectSecretCandidates(JSON.parse(t), out); } catch {}
    out.push(t);
    t.split(/[\n,]/).map((p) => p.trim()).filter(Boolean).forEach((p) => out.push(p));
    return out;
  }
  if (Array.isArray(value)) value.forEach((i) => collectSecretCandidates(i, out));
  else if (typeof value === "object") Object.values(value).forEach((i) => collectSecretCandidates(i, out));
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
  return (
    c.find((k) => jwtRole(k) === "service_role") ??
    c.find((k) => k.startsWith("sb_secret_")) ??
    c[0] ??
    null
  );
}
function adminClient() {
  const k = getServiceRoleKey();
  if (k) return createClient(SUPABASE_URL, k, { auth: { persistSession: false } });
  return createClient(SUPABASE_URL, PUBLISHABLE_KEY, { auth: { persistSession: false } });
}

const EXPORT_COLS = [
  "acct","patient","dob","dos","cpt","icd10","pri_ins","sec_ins","prov_name",
  "visit_type","service_category","revenue","pay_date","days_to_pmt","company",
  "facility","referrer","is_primary_billable","denial","source_file_id","created_at",
];

function csvEscape(v: any): string {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function runExport(jobId: string, requestedBy: string, filters: any) {
  const db = adminClient();
  try {
    await db.from("export_jobs").update({ status: "running" }).eq("id", jobId);
    let q = db.from("claims_raw").select(EXPORT_COLS.join(","));
    if (filters?.companies?.length)  q = q.in("company", filters.companies);
    if (filters?.providers?.length)  q = q.in("prov_name", filters.providers);
    if (filters?.insurances?.length) q = q.in("pri_ins", filters.insurances);
    if (filters?.categories?.length) q = q.in("service_category", filters.categories);
    if (filters?.date_from) q = q.gte("dos", filters.date_from);
    if (filters?.date_to)   q = q.lte("dos", filters.date_to);
    if (filters?.source_file_id) q = q.eq("source_file_id", filters.source_file_id);

    const PAGE = 1000;
    let from = 0;
    const lines: string[] = [EXPORT_COLS.join(",")];
    let total = 0;
    // hard cap to avoid runaway
    const MAX_ROWS = 200_000;
    while (true) {
      const { data, error } = await q.range(from, from + PAGE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      for (const r of data as any[]) {
        lines.push(EXPORT_COLS.map((c) => csvEscape(r[c])).join(","));
      }
      total += data.length;
      if (data.length < PAGE) break;
      from += PAGE;
      if (total >= MAX_ROWS) break;
    }
    const csv = lines.join("\n");
    const bytes = new TextEncoder().encode(csv);
    const filename = `claims-export-${new Date().toISOString().slice(0,10)}-${jobId.slice(0,8)}.csv`;

    await db.from("export_jobs").update({
      status: "done",
      row_count: total,
      file_bytes: bytes,
      filename,
      completed_at: new Date().toISOString(),
    }).eq("id", jobId);

    await db.from("phi_access_log").insert({
      user_id: requestedBy,
      action: "export",
      target_table: "claims_raw",
      row_count: total,
      details: { job_id: jobId, filters },
    });
  } catch (e: any) {
    console.error("run-export failed", e);
    await db.from("export_jobs").update({
      status: "failed",
      error: e?.message ?? "Export failed",
      completed_at: new Date().toISOString(),
    }).eq("id", jobId);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: u } = await userClient.auth.getUser();
    if (!u?.user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { name, filters } = await req.json();
    const db = adminClient();
    const { data: job, error } = await db.from("export_jobs").insert({
      requested_by: u.user.id,
      name: name ?? null,
      filters: filters ?? {},
      status: "queued",
    }).select("id").single();
    if (error || !job) throw error ?? new Error("insert failed");

    const promise = runExport(job.id, u.user.id, filters ?? {});
    const er = (globalThis as any).EdgeRuntime;
    if (typeof er?.waitUntil === "function") er.waitUntil(promise);
    else await promise;

    return new Response(JSON.stringify({ job_id: job.id }), { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message ?? "export failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
