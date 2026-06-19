// @ts-nocheck
// Evaluates active alert_rules and fans out notifications.
// - When called by an admin via the UI: returns the result synchronously.
// - When called by pg_cron with apikey: same behaviour, no auth check needed beyond apikey.
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
  return c.find((k) => jwtRole(k) === "service_role") ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const serviceKey = getServiceRoleKey();
    if (!serviceKey) {
      return new Response(JSON.stringify({ error: "Service role key unavailable" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // If a user JWT is present, require admin. Otherwise (cron) accept the apikey.
    const authHeader = req.headers.get("Authorization") ?? "";
    if (authHeader) {
      const userClient = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
      });
      const { data: u } = await userClient.auth.getUser();
      if (u?.user) {
        const { data: isAdmin } = await userClient.rpc("has_role", {
          _user_id: u.user.id, _role: "admin",
        });
        if (!isAdmin) {
          return new Response(JSON.stringify({ error: "Admin only" }), {
            status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    const admin = createClient(SUPABASE_URL, serviceKey, { auth: { persistSession: false } });
    const { data, error } = await admin.rpc("evaluate_alert_rules");
    if (error) throw error;

    return new Response(JSON.stringify(data ?? { created: 0 }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("evaluate-alerts failed", e);
    return new Response(JSON.stringify({ error: e?.message ?? "evaluation failed" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
