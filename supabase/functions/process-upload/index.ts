// Edge function: process-upload
// New flow: client uploads file bytes + pre-parsed rows. We:
//   1. Persist the original bytes in source_files (immutable record).
//   2. Map columns -> field_definitions registry, compute confidence.
//   3. Normalize + validate each row, write to parsed_rows for human review.
// Approval happens in a separate function (approve-source-file).

// @ts-nocheck
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
  // Prefer a verified JWT with service_role; otherwise accept the new sb_secret_* format.
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

// ── normalizers ──
function normText(v: any): string | null {
  if (v == null) return null;
  const s = String(v).trim(); return s === "" ? null : s;
}
function normDate(v: any): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
function normNum(v: any): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[$,]/g, ""));
  return isNaN(n) ? null : n;
}
function normBool(v: any): boolean {
  if (v == null || v === "") return false;
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  return s === "true" || s === "yes" || s === "y" || s === "1" || s === "denied";
}

// Levenshtein for fuzzy header matching
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n; if (n === 0) return m;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = i - 1, cur = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      cur = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      dp[j - 1] = cur === undefined ? dp[j - 1] : (j === 1 ? i : dp[j - 1]);
      dp[j] = cur; prev = tmp;
    }
  }
  return dp[n];
}
function norm(s: string) { return s.toLowerCase().replace(/[^a-z0-9]+/g, ""); }

type FieldDef = {
  field_key: string; label: string; data_type: string;
  validation_regex: string | null; synonyms: string[];
};

function mapColumn(header: string, defs: FieldDef[]): { field: string | null; confidence: number } {
  const h = norm(header);
  if (!h) return { field: null, confidence: 0 };
  // exact field_key
  for (const d of defs) if (norm(d.field_key) === h) return { field: d.field_key, confidence: 1.0 };
  // exact synonym / label
  for (const d of defs) {
    const all = [d.label, ...d.synonyms];
    for (const a of all) if (norm(a) === h) return { field: d.field_key, confidence: 1.0 };
  }
  // fuzzy (Levenshtein <= 2)
  let best: { field: string | null; dist: number; len: number } = { field: null, dist: Infinity, len: 0 };
  for (const d of defs) {
    const all = [d.field_key, d.label, ...d.synonyms];
    for (const a of all) {
      const na = norm(a); if (!na) continue;
      const dist = levenshtein(h, na);
      if (dist < best.dist) best = { field: d.field_key, dist, len: na.length };
    }
  }
  if (best.field && best.dist <= 2 && best.len >= 3) {
    return { field: best.field, confidence: best.dist === 0 ? 1.0 : best.dist === 1 ? 0.85 : 0.7 };
  }
  return { field: null, confidence: 0 };
}

function normalizeByType(t: string, v: any) {
  switch (t) {
    case "date": return normDate(v);
    case "number": return normNum(v);
    case "bool": return normBool(v);
    case "cpt":
    case "icd10":
    case "text":
    default: return normText(v);
  }
}
function validate(def: FieldDef, value: any): string | null {
  if (value == null || value === "") return null; // null is allowed at validation level
  if (def.data_type === "number" && typeof value !== "number") return "Not a number";
  if (def.data_type === "date" && typeof value !== "string") return "Not a date";
  if (def.validation_regex) {
    try {
      const re = new RegExp(def.validation_regex);
      if (!re.test(String(value))) return `Does not match ${def.field_key} format`;
    } catch {}
  }
  return null;
}

type Row = Record<string, any>;
const BATCH = 1000;
const INSERT_CONCURRENCY = 4;

// ── LLM extraction for unstructured text (PDF/DOCX/TXT) ──
async function extractRowsFromText(text: string, defs: FieldDef[]): Promise<Row[]> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) throw new Error("LOVABLE_API_KEY is not configured");

  // Cap input to keep prompt within model limits (~120k chars ≈ 30k tokens)
  const MAX = 120_000;
  const clipped = text.length > MAX ? text.slice(0, MAX) : text;

  const fieldDescriptions = defs.map((d) =>
    `- ${d.field_key} (${d.data_type})${d.label !== d.field_key ? ` — ${d.label}` : ""}`
  ).join("\n");

  const properties: Record<string, any> = {};
  for (const d of defs) {
    const base: any =
      d.data_type === "number" ? { type: ["number", "null"] }
      : d.data_type === "bool" ? { type: ["boolean", "null"] }
      : { type: ["string", "null"] };
    if (d.data_type === "date") base.description = "ISO date YYYY-MM-DD";
    properties[d.field_key] = base;
  }

  const tool = {
    type: "function",
    function: {
      name: "emit_claim_rows",
      description: "Emit one object per claim line found in the document.",
      parameters: {
        type: "object",
        properties: {
          rows: {
            type: "array",
            items: { type: "object", properties, additionalProperties: false },
          },
        },
        required: ["rows"],
        additionalProperties: false,
      },
    },
  };

  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        {
          role: "system",
          content: [
            "You extract billing claim rows from medical / billing documents.",
            "Return ONE row per CPT line per encounter. If a single visit has multiple CPTs, emit multiple rows that repeat the patient/visit info.",
            "Use ISO YYYY-MM-DD for all dates. Use null for unknown values — never invent.",
            "Available fields:",
            fieldDescriptions,
          ].join("\n"),
        },
        { role: "user", content: clipped },
      ],
      tools: [tool],
      tool_choice: { type: "function", function: { name: "emit_claim_rows" } },
    }),
  });

  if (resp.status === 429) throw new Error("AI rate limit hit — try again in a moment.");
  if (resp.status === 402) throw new Error("AI credits exhausted — top up Lovable AI to continue.");
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`AI extraction failed (${resp.status}): ${t.slice(0, 300)}`);
  }
  const json = await resp.json();
  const call = json?.choices?.[0]?.message?.tool_calls?.[0];
  const argsStr = call?.function?.arguments;
  if (!argsStr) throw new Error("AI returned no structured output");
  let parsed: any;
  try { parsed = JSON.parse(argsStr); }
  catch { throw new Error("AI returned malformed JSON"); }
  const rows = Array.isArray(parsed?.rows) ? parsed.rows : [];
  return rows.filter((r: any) => r && typeof r === "object");
}

async function processInBackground(sourceFileId: string, rows: Row[], defs: FieldDef[], opts?: { text?: string; kind?: string; filename?: string }) {
  const db = adminClient();
  try {
    await db.from("source_files").update({ status: "parsing" }).eq("id", sourceFileId);

    // Unstructured path: run LLM extraction first
    if (opts?.kind === "unstructured") {
      if (!opts.text || opts.text.trim().length < 20) {
        throw new Error("Document contains no extractable text.");
      }
      rows = await extractRowsFromText(opts.text, defs);
      if (rows.length === 0) {
        await db.from("source_files").update({
          status: "needs_review", row_count: 0,
          error: "AI extracted no rows from this document.",
        }).eq("id", sourceFileId);
        return;
      }
    }
    await db.from("source_files").update({ row_count: rows.length }).eq("id", sourceFileId);

    // Column mapping from union of headers
    const headers = Array.from(new Set(rows.flatMap((r) => Object.keys(r ?? {}))));
    const validKeys = new Set(defs.map((d) => d.field_key));
    const mapping: Record<string, { field: string | null; confidence: number }> = {};

    // Detect company first (used to pick a mapping template)
    let detectedCompany: string | null = null;
    for (const r of rows) {
      for (const h of headers) {
        if (norm(h) === norm("company")) {
          const v = normText((r as any)[h]);
          if (v) { detectedCompany = v; break; }
        }
      }
      if (detectedCompany) break;
    }

    // Load active mapping templates and pick the highest-priority match
    let appliedTemplate: { id: string; mapping: Record<string, string> } | null = null;
    try {
      const { data: tpls } = await db.from("mapping_templates")
        .select("id,match_company,match_filename_pattern,mapping,priority")
        .eq("is_active", true).order("priority", { ascending: false });
      for (const t of (tpls ?? []) as any[]) {
        const companyMatch = t.match_company
          ? (detectedCompany && detectedCompany.toLowerCase() === String(t.match_company).toLowerCase())
          : false;
        let fileMatch = false;
        if (t.match_filename_pattern && opts?.filename) {
          try { fileMatch = new RegExp(t.match_filename_pattern, "i").test(opts.filename); } catch {}
        }
        if (companyMatch || fileMatch) {
          appliedTemplate = { id: t.id, mapping: t.mapping ?? {} };
          break;
        }
      }
    } catch (e) { console.error("template lookup failed", e); }

    for (const h of headers) {
      // 1) explicit template wins
      const tpl = appliedTemplate?.mapping?.[h];
      if (tpl && validKeys.has(tpl)) {
        mapping[h] = { field: tpl, confidence: 1.0 };
        continue;
      }
      // 2) fall back to fuzzy registry mapping
      mapping[h] = mapColumn(h, defs);
    }
    const unmapped = Object.entries(mapping).filter(([, m]) => !m.field).map(([h]) => h);

    const defByKey = new Map(defs.map((d) => [d.field_key, d]));

    await db.from("source_files").update({
      column_mapping: mapping,
      unmapped_columns: unmapped,
      detected_company: detectedCompany,
      mapping_template_id: appliedTemplate?.id ?? null,
    }).eq("id", sourceFileId);

    // Wipe any prior parsed rows (re-parse path)
    await db.from("parsed_rows").delete().eq("source_file_id", sourceFileId);

    for (let start = 0; start < rows.length; start += BATCH) {
      const batch = rows.slice(start, start + BATCH).map((r, idx) => {
        const data: Record<string, any> = {};
        const confidence: Record<string, number> = {};
        const errs: Record<string, string> = {};
        for (const [h, m] of Object.entries(mapping)) {
          if (!m.field) continue;
          const def = defByKey.get(m.field); if (!def) continue;
          const norm = normalizeByType(def.data_type, (r as any)[h]);
          data[m.field] = norm;
          const err = validate(def, norm);
          confidence[m.field] = err ? 0 : m.confidence;
          if (err) errs[m.field] = err;
        }
        return {
          source_file_id: sourceFileId,
          row_index: start + idx,
          source_row: start + idx + 2,
          data,
          raw_data: r,
          confidence,
          validation_errors: errs,
        };
      });
      const { error } = await db.from("parsed_rows").insert(batch);
      if (error) throw error;
    }

    // Flag duplicates against claims_raw + intra-file
    try { await db.rpc("flag_duplicate_parsed_rows", { _source_file_id: sourceFileId }); }
    catch (e) { console.error("dedup flagging failed", e); }

    await db.from("source_files").update({
      status: "needs_review",
      row_count: rows.length,
    }).eq("id", sourceFileId);
  } catch (err: any) {
    console.error("process-upload bg failed", err);
    await db.from("source_files").update({
      status: "failed",
      error: err?.message ?? "Processing failed",
    }).eq("id", sourceFileId);
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
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
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
    const { filename, mime, size_bytes, file_b64, rows, text, kind } = body as {
      filename: string; mime?: string; size_bytes?: number;
      file_b64?: string;
      rows?: Row[];
      text?: string;
      kind?: "structured" | "unstructured";
    };
    const fileKind: "structured" | "unstructured" = kind === "unstructured" ? "unstructured" : "structured";
    if (!filename) {
      return new Response(JSON.stringify({ error: "filename required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (fileKind === "structured" && !Array.isArray(rows)) {
      return new Response(JSON.stringify({ error: "rows[] required for structured uploads" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (fileKind === "unstructured" && (!text || typeof text !== "string")) {
      return new Response(JSON.stringify({ error: "text required for unstructured uploads" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const db = adminClient();

    const { data: defs, error: defsErr } = await db
      .from("field_definitions").select("field_key,label,data_type,validation_regex,synonyms")
      .eq("is_active", true);
    if (defsErr) throw defsErr;

    let fileBytes: Uint8Array | null = null;
    if (file_b64) {
      const bin = atob(file_b64);
      fileBytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) fileBytes[i] = bin.charCodeAt(i);
    }

    const { data: sf, error: sfErr } = await db.from("source_files").insert({
      uploaded_by: userId,
      filename,
      mime: mime ?? null,
      size_bytes: size_bytes ?? fileBytes?.byteLength ?? 0,
      file_bytes: fileBytes,
      status: "queued",
      row_count: fileKind === "structured" ? (rows?.length ?? 0) : 0,
      kind: fileKind,
    }).select("id").single();
    if (sfErr || !sf) {
      return new Response(JSON.stringify({ error: sfErr?.message ?? "Failed to record file" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const promise = processInBackground(
      sf.id,
      rows ?? [],
      (defs ?? []) as FieldDef[],
      { text, kind: fileKind, filename },
    );
    const er = (globalThis as any).EdgeRuntime;
    if (typeof er?.waitUntil === "function") er.waitUntil(promise);
    else await promise;

    return new Response(JSON.stringify({ source_file_id: sf.id }), {
      status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("process-upload failed", err);
    return new Response(JSON.stringify({ error: err?.message ?? "Unexpected error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
