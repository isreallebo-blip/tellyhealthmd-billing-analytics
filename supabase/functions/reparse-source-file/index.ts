// Edge function: reparse-source-file
// Reads the stored bytes from source_files.file_bytes, re-parses with current
// field_definitions registry, and replaces parsed_rows. No re-upload required.

// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";

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

// ── shared with process-upload (kept inline to avoid cross-fn imports) ──
function normText(v: any): string | null { if (v == null) return null; const s = String(v).trim(); return s === "" ? null : s; }
function normDate(v: any): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") { const d = new Date(Math.round((v - 25569) * 86400 * 1000)); return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10); }
  const d = new Date(v); return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
function normNum(v: any): number | null { if (v == null || v === "") return null; const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[$,]/g, "")); return isNaN(n) ? null : n; }
function normBool(v: any): boolean { if (v == null || v === "") return false; if (typeof v === "boolean") return v; const s = String(v).trim().toLowerCase(); return s === "true" || s === "yes" || s === "y" || s === "1" || s === "denied"; }
function normalizeByType(t: string, v: any) {
  switch (t) { case "date": return normDate(v); case "number": return normNum(v); case "bool": return normBool(v); default: return normText(v); }
}
function norm(s: string) { return s.toLowerCase().replace(/[^a-z0-9]+/g, ""); }
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length; if (m === 0) return n; if (n === 0) return m;
  const dp = new Array(n + 1); for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = i - 1;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[n];
}
type FieldDef = { field_key: string; label: string; data_type: string; validation_regex: string | null; synonyms: string[] };
function mapColumn(header: string, defs: FieldDef[]) {
  const h = norm(header); if (!h) return { field: null as string | null, confidence: 0 };
  for (const d of defs) if (norm(d.field_key) === h) return { field: d.field_key, confidence: 1.0 };
  for (const d of defs) for (const a of [d.label, ...d.synonyms]) if (norm(a) === h) return { field: d.field_key, confidence: 1.0 };
  let best: { field: string | null; dist: number; len: number } = { field: null, dist: Infinity, len: 0 };
  for (const d of defs) for (const a of [d.field_key, d.label, ...d.synonyms]) {
    const na = norm(a); if (!na) continue;
    const dist = levenshtein(h, na);
    if (dist < best.dist) best = { field: d.field_key, dist, len: na.length };
  }
  if (best.field && best.dist <= 2 && best.len >= 3) return { field: best.field, confidence: best.dist === 0 ? 1.0 : best.dist === 1 ? 0.85 : 0.7 };
  return { field: null, confidence: 0 };
}
function validate(def: FieldDef, value: any): string | null {
  if (value == null || value === "") return null;
  if (def.data_type === "number" && typeof value !== "number") return "Not a number";
  if (def.data_type === "date" && typeof value !== "string") return "Not a date";
  if (def.validation_regex) {
    try { if (!new RegExp(def.validation_regex).test(String(value))) return `Does not match ${def.field_key} format`; } catch {}
  }
  return null;
}

const BATCH = 200;
const MAX_INSERT_RETRIES = 4;

async function insertWithRetry(db: any, batch: any[]): Promise<void> {
  const tryInsert = async (rows: any[], attempt: number): Promise<void> => {
    const { error } = await db.from("parsed_rows").insert(rows);
    if (!error) return;
    const timeout = error.code === "57014" || /timeout/i.test(error.message ?? "");
    if (attempt >= MAX_INSERT_RETRIES || rows.length <= 25 || !timeout) throw error;
    const mid = Math.ceil(rows.length / 2);
    await tryInsert(rows.slice(0, mid), attempt + 1);
    await tryInsert(rows.slice(mid), attempt + 1);
  };
  await tryInsert(batch, 0);
}

async function reparseInBackground(sourceFileId: string) {
  const db = adminClient();
  try {
    await db.from("source_files").update({ status: "parsing", error: null }).eq("id", sourceFileId);

    const { data: sf, error: sfErr } = await db
      .rpc("download_source_file", { _id: sourceFileId })
      .maybeSingle();
    if (sfErr || !sf) throw new Error("Source file not found");
    if (sf.kind === "unstructured") {
      throw new Error("Re-parse for AI-extracted documents isn't supported yet — adjust field synonyms and re-upload the file, or edit rows inline and Approve.");
    }
    if (!sf.file_bytes) throw new Error("Original file bytes are not stored — please re-upload.");

    // file_bytes comes back as hex string "\\x..." from PostgREST
    const hex: string = typeof sf.file_bytes === "string" ? sf.file_bytes : "";
    const clean = hex.startsWith("\\x") ? hex.slice(2) : hex;
    const bytes = new Uint8Array(clean.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.substr(i * 2, 2), 16);

    const wb = XLSX.read(bytes, { type: "array", cellDates: false });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows: Record<string, any>[] = XLSX.utils.sheet_to_json(sheet, { defval: null });

    const { data: defs } = await db
      .from("field_definitions").select("field_key,label,data_type,validation_regex,synonyms").eq("is_active", true);

    const headers = Array.from(new Set(rows.flatMap((r) => Object.keys(r ?? {}))));
    const mapping: Record<string, any> = {};
    const unmapped: string[] = [];
    for (const h of headers) {
      const m = mapColumn(h, (defs ?? []) as FieldDef[]);
      mapping[h] = m;
      if (!m.field) unmapped.push(h);
    }
    const defByKey = new Map((defs ?? []).map((d: any) => [d.field_key, d]));
    let detectedCompany: string | null = null;
    for (const r of rows) {
      for (const [h, m] of Object.entries(mapping)) {
        if ((m as any).field === "company") { const v = normText((r as any)[h]); if (v) { detectedCompany = v; break; } }
      }
      if (detectedCompany) break;
    }

    await db.from("source_files").update({
      column_mapping: mapping, unmapped_columns: unmapped,
      detected_company: detectedCompany, row_count: rows.length,
    }).eq("id", sourceFileId);

    await db.from("parsed_rows").delete().eq("source_file_id", sourceFileId);

    for (let start = 0; start < rows.length; start += BATCH) {
      const chunk = rows.slice(start, start + BATCH).map((r, idx) => {
        const data: Record<string, any> = {};
        const confidence: Record<string, number> = {};
        const errs: Record<string, string> = {};
        for (const [h, m] of Object.entries(mapping)) {
          const mm = m as any; if (!mm.field) continue;
          const def = defByKey.get(mm.field) as FieldDef | undefined; if (!def) continue;
          const v = normalizeByType(def.data_type, (r as any)[h]);
          data[mm.field] = v;
          const err = validate(def, v);
          confidence[mm.field] = err ? 0 : mm.confidence;
          if (err) errs[mm.field] = err;
        }
        return {
          source_file_id: sourceFileId, row_index: start + idx, source_row: start + idx + 2,
          data, confidence, validation_errors: errs,
        };
      });
      await insertWithRetry(db, chunk);
    }

    try { await db.rpc("flag_duplicate_parsed_rows", { _source_file_id: sourceFileId }); }
    catch (e) { console.error("dedup flagging failed", e); }

    await db.from("source_files").update({ status: "needs_review" }).eq("id", sourceFileId);
  } catch (err: any) {
    console.error("reparse bg failed", err);
    await db.from("source_files").update({
      status: "failed", error: err?.message ?? "Re-parse failed",
    }).eq("id", sourceFileId);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
      global: { headers: { Authorization: authHeader } }, auth: { persistSession: false },
    });
    const { data: ud, error: uerr } = await userClient.auth.getUser();
    if (uerr || !ud?.user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });

    const { source_file_id } = await req.json();
    if (!source_file_id) return new Response(JSON.stringify({ error: "source_file_id required" }), { status: 400, headers: corsHeaders });

    // RLS check
    const { data: sf } = await userClient.from("source_files").select("id").eq("id", source_file_id).maybeSingle();
    if (!sf) return new Response(JSON.stringify({ error: "Not found or no access" }), { status: 404, headers: corsHeaders });

    const promise = reparseInBackground(source_file_id);
    const er = (globalThis as any).EdgeRuntime;
    if (typeof er?.waitUntil === "function") er.waitUntil(promise);
    else await promise;

    return new Response(JSON.stringify({ ok: true }), { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    console.error("reparse failed", err);
    return new Response(JSON.stringify({ error: err?.message ?? "Unexpected error" }), { status: 500, headers: corsHeaders });
  }
});
