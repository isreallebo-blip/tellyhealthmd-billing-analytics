// Edge function: unapprove-source-file
// Reverts an approved file back to needs_review and removes its claims_raw rows
// so the user can edit and re-publish (or re-analyze) cleanly.
//
// Non-admin users cannot delete from claims_raw directly (RLS), so this function
// uses the service-role client after verifying the caller has access to the file
// via their authenticated user client.

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
  return (
    c.find((k) => jwtRole(k) === "service_role") ??
    c.find((k) => k.startsWith("sb_secret_")) ??
    c[0] ??
    null
  );
}
function adminClient() {
  const k = getServiceRoleKey();
  if (!k) throw new Error("Service role key not configured");
  return createClient(SUPABASE_URL, k, { auth: { persistSession: false } });
}

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

    const { source_file_id } = await req.json();
    if (!source_file_id) {
      return new Response(JSON.stringify({ error: "source_file_id required" }), { status: 400, headers: corsHeaders });
    }

    // RLS-checked access: user must own the file, be admin, or have company access.
    const { data: sf, error: sfErr } = await userClient
      .from("source_files").select("id,status").eq("id", source_file_id).maybeSingle();
    if (sfErr || !sf) {
      return new Response(JSON.stringify({ error: "Not found or no access" }), { status: 404, headers: corsHeaders });
    }

    const db = adminClient();

    // Remove published claims for this file and revert status.
    const { error: delErr } = await db.from("claims_raw").delete().eq("source_file_id", source_file_id);
    if (delErr) throw delErr;

    const { error: upErr } = await db.from("source_files").update({
      status: "needs_review",
      approved_at: null,
      approved_by: null,
      error: null,
    }).eq("id", source_file_id);
    if (upErr) throw upErr;

    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("unapprove-source-file failed", err);
    return new Response(JSON.stringify({ error: err?.message ?? "Unexpected error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
