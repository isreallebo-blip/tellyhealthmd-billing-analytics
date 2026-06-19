// Edge function: process-upload
// Accepts parsed Excel rows, creates an upload_jobs row, then processes rows
// in the background (EdgeRuntime.waitUntil) so the browser can navigate away.

// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;

type Row = Record<string, any>;

function parseDate(v: any): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") {
    // Excel serial date
    const o = new Date(Math.round((v - 25569) * 86400 * 1000));
    if (isNaN(o.getTime())) return null;
    return o.toISOString().slice(0, 10);
  }
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}
function parseNum(v: any): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[$,]/g, ""));
  return isNaN(n) ? null : n;
}
function parseBool(v: any): boolean {
  if (v == null || v === "") return false;
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  return s === "true" || s === "yes" || s === "y" || s === "1" || s === "denied";
}

type Normalized = {
  rowIndex: number;
  company: string;
  acct: string;
  dos: string;
  cpt: string;
  payload: Record<string, any>;
  revenue: number | null;
  pay_date: string | null;
  days_to_pmt: number | null;
  denied_claim: boolean;
};

const BATCH_SIZE = 500;

async function processRows(jobId: string, userId: string, filename: string, rows: Row[]) {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  let inserted = 0, updated = 0, skipped = 0, unknownCpt = 0, processed = 0;
  const errors: string[] = [];
  const perCompany: Record<string, {
    processed: number; inserted: number; updated: number; skipped: number; unknownCpt: number;
    skippedRows: { acct: string; dos: string; cpt: string; company: string; reason: string }[];
    unknownCpts: Record<string, number>;
    uploadHistoryId?: string;
  }> = {};

  function ensureCompanyState(company: string) {
    if (!perCompany[company]) {
      perCompany[company] = { processed: 0, inserted: 0, updated: 0, skipped: 0, unknownCpt: 0, skippedRows: [], unknownCpts: {} };
    }
    return perCompany[company];
  }

  try {
    const [{ data: cptRef }, { data: overrides }] = await Promise.all([
      admin.from("cpt_reference").select("cpt_code,service_category,billing_type"),
      admin.from("cpt_insurance_overrides").select("cpt_code,insurance_code,billing_type_override"),
    ]);
    const cptMap = new Map<string, { service_category: string | null; billing_type: string | null }>();
    cptRef?.forEach((r: any) =>
      cptMap.set(String(r.cpt_code).toUpperCase(), { service_category: r.service_category, billing_type: r.billing_type })
    );
    const overrideMap = new Map<string, string>();
    overrides?.forEach((r: any) =>
      overrideMap.set(`${String(r.cpt_code).toUpperCase()}|${String(r.insurance_code).toUpperCase()}`, r.billing_type_override)
    );

    // ── Phase 1: normalize every row in memory ──
    const normalized: Normalized[] = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      processed++;
      try {
        const company = String(r["Company"] ?? "").trim();
        if (!company) { skipped++; continue; }
        const cs = ensureCompanyState(company);
        cs.processed++;

        const cpt = String(r["CPT"] ?? "").trim().toUpperCase();
        const pri_ins = String(r["Pri_Ins"] ?? "").trim().toUpperCase();
        const acct = String(r["Acct"] ?? "").trim();
        const dos = parseDate(r["DOS"]);
        if (!acct || !dos || !cpt) { skipped++; cs.skipped++; continue; }

        const ref = cptMap.get(cpt);
        let billing_type = ref?.billing_type ?? null;
        const service_category = ref?.service_category ?? null;
        if (!ref) {
          unknownCpt++; cs.unknownCpt++;
          cs.unknownCpts[cpt] = (cs.unknownCpts[cpt] ?? 0) + 1;
        }
        const ov = overrideMap.get(`${cpt}|${pri_ins}`);
        if (ov) billing_type = ov;
        const is_primary_billable = ref ? billing_type === "Primary" : true;

        const revenue = parseNum(r["Revenue"]);
        const days_to_pmt = parseNum(r["DaysToPmt"]);
        const pay_date = parseDate(r["paydate"]);
        const denied_claim = parseBool(r["Denied Claim"]);

        const payload: Record<string, any> = {
          company,
          pt_name: r["PT Name"] ?? null,
          dob: parseDate(r["DOB"]),
          pri_ins,
          prov_code: r["Prov"] ?? null,
          prov_name: r["Prov Name"] ?? null,
          dos, cpt,
          avg_days_to_pmt: parseNum(r["AvgDsToPmt"]),
          days_to_pmt,
          visit_type: r["Visit Type"] ?? null,
          revenue, pay_date, denied_claim,
          mrn: r["MRN"] ?? null,
          acct,
          service_category,
          is_primary_billable,
        };

        normalized.push({ rowIndex: i, company, acct, dos, cpt, payload, revenue, pay_date, days_to_pmt, denied_claim });
      } catch (err: any) {
        errors.push(`Row ${i + 2}: ${err?.message ?? "error"}`);
      }
    }

    // ── Phase 2: ensure upload_history row for every company seen ──
    const companies = Object.keys(perCompany);
    await Promise.all(companies.map(async (company) => {
      const cs = perCompany[company];
      const { data } = await admin.from("upload_history").insert({
        filename, company, uploaded_by: userId,
        rows_processed: 0, rows_inserted: 0, rows_updated: 0, rows_skipped: 0, unknown_cpt_count: 0,
      }).select("id").single();
      if (data) cs.uploadHistoryId = data.id;
    }));

    // ── Phase 3: process in batches of BATCH_SIZE ──
    let lastProgressAt = 0;
    for (let start = 0; start < normalized.length; start += BATCH_SIZE) {
      const batch = normalized.slice(start, start + BATCH_SIZE);

      // Bulk lookup existing rows for the batch.
      // Multi-column IN isn't supported via PostgREST, so we filter by the
      // distinct values per column and de-dup client-side using a composite key.
      const accts = Array.from(new Set(batch.map((b) => b.acct)));
      const doses = Array.from(new Set(batch.map((b) => b.dos)));
      const cpts = Array.from(new Set(batch.map((b) => b.cpt)));
      const companiesInBatch = Array.from(new Set(batch.map((b) => b.company)));

      const { data: existingRows, error: lookupErr } = await admin
        .from("claims_raw")
        .select("id,acct,dos,cpt,company,revenue")
        .in("company", companiesInBatch)
        .in("acct", accts)
        .in("dos", doses)
        .in("cpt", cpts);
      if (lookupErr) throw lookupErr;

      const existingMap = new Map<string, { id: string; revenue: number | null }>();
      (existingRows ?? []).forEach((r: any) => {
        existingMap.set(`${r.company}|${r.acct}|${r.dos}|${r.cpt}`, { id: r.id, revenue: r.revenue });
      });

      const toInsert: Record<string, any>[] = [];
      const toUpdate: { id: string; revenue: number | null; pay_date: string | null; days_to_pmt: number | null; denied_claim: boolean; uploadHistoryId: string | undefined; item: Normalized }[] = [];

      for (const item of batch) {
        const cs = ensureCompanyState(item.company);
        const uploadHistoryId = cs.uploadHistoryId;
        const key = `${item.company}|${item.acct}|${item.dos}|${item.cpt}`;
        const existing = existingMap.get(key);

        if (!existing) {
          toInsert.push({ ...item.payload, upload_id: uploadHistoryId });
        } else {
          const oldRev = existing.revenue;
          const hasNewPmt = item.revenue != null && (oldRev == null || Number(oldRev) === 0);
          if (hasNewPmt) {
            toUpdate.push({
              id: existing.id,
              revenue: item.revenue,
              pay_date: item.pay_date,
              days_to_pmt: item.days_to_pmt,
              denied_claim: item.denied_claim,
              uploadHistoryId,
              item,
            });
          } else {
            skipped++; cs.skipped++;
            cs.skippedRows.push({ acct: item.acct, dos: item.dos, cpt: item.cpt, company: item.company, reason: "Duplicate - no new payment" });
          }
        }
      }

      // Bulk insert new rows
      if (toInsert.length) {
        const { error: insErr } = await admin.from("claims_raw").insert(toInsert);
        if (insErr) {
          errors.push(`Batch insert (${toInsert.length} rows): ${insErr.message}`);
        } else {
          inserted += toInsert.length;
          for (const row of toInsert) {
            const cs = ensureCompanyState(row.company);
            cs.inserted++;
          }
        }
      }

      // Per-row updates (rare path)
      for (const u of toUpdate) {
        const cs = ensureCompanyState(u.item.company);
        const { error: upErr } = await admin
          .from("claims_raw")
          .update({
            revenue: u.revenue,
            pay_date: u.pay_date,
            days_to_pmt: u.days_to_pmt,
            denied_claim: u.denied_claim,
            last_updated_upload_id: u.uploadHistoryId,
          })
          .eq("id", u.id);
        if (upErr) {
          errors.push(`Row ${u.item.rowIndex + 2} update: ${upErr.message}`);
        } else {
          updated++; cs.updated++;
          cs.skippedRows.push({ acct: u.item.acct, dos: u.item.dos, cpt: u.item.cpt, company: u.item.company, reason: "Duplicate - updated" });
        }
      }

      const now = Date.now();
      if (now - lastProgressAt > 1000 || start + BATCH_SIZE >= normalized.length) {
        lastProgressAt = now;
        await admin.from("upload_jobs").update({
          processed_rows: Math.min(start + BATCH_SIZE, normalized.length),
          inserted, updated, skipped, unknown_cpt: unknownCpt,
        }).eq("id", jobId);
      }
    }

    // Finalize per-company upload_history rows
    await Promise.all(Object.entries(perCompany).map(async ([_c, s]) => {
      if (!s.uploadHistoryId) return;
      await admin.from("upload_history").update({
        rows_processed: s.processed,
        rows_inserted: s.inserted,
        rows_updated: s.updated,
        rows_skipped: s.skipped,
        unknown_cpt_count: s.unknownCpt,
        skipped_rows: s.skippedRows.slice(0, 5000),
        unknown_cpts: s.unknownCpts,
      }).eq("id", s.uploadHistoryId);
    }));

    await admin.from("upload_jobs").update({
      status: "complete",
      processed_rows: processed, inserted, updated, skipped, unknown_cpt: unknownCpt,
      error_message: errors.length ? `${errors.length} row errors. First: ${errors[0]}` : null,
      completed_at: new Date().toISOString(),
    }).eq("id", jobId);
  } catch (err: any) {
    await admin.from("upload_jobs").update({
      status: "error",
      processed_rows: processed, inserted, updated, skipped, unknown_cpt: unknownCpt,
      error_message: err?.message ?? "Processing failed",
      completed_at: new Date().toISOString(),
    }).eq("id", jobId);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // Verify the caller
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const body = await req.json();
    const { filename, rows } = body as { filename: string; rows: Row[] };
    if (!filename || !Array.isArray(rows)) {
      return new Response(JSON.stringify({ error: "Invalid body" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data: job, error: jobErr } = await admin.from("upload_jobs").insert({
      user_id: userId,
      filename,
      status: "processing",
      total_rows: rows.length,
    }).select("id").single();
    if (jobErr || !job) {
      return new Response(JSON.stringify({ error: jobErr?.message ?? "Failed to create job" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Prefer background processing when the runtime supports it. If not, run
    // inline instead of throwing a 500 after the job row has already been made.
    const processingPromise = processRows(job.id, userId, filename, rows);
    const edgeRuntime = (globalThis as any).EdgeRuntime;
    if (typeof edgeRuntime?.waitUntil === "function") {
      edgeRuntime.waitUntil(processingPromise);
    } else {
      await processingPromise;
    }

    return new Response(JSON.stringify({ jobId: job.id }), {
      status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("process-upload failed", err);
    return new Response(JSON.stringify({ error: err?.message ?? "Unexpected error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
