import { supabase } from "@/integrations/supabase/client";

export async function logPhiAccess(payload: {
  action: string;
  target_table?: string;
  target_id?: string | null;
  source_file_id?: string | null;
  row_count?: number;
  details?: Record<string, unknown>;
}) {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    const url = import.meta.env.VITE_SUPABASE_URL as string;
    const apikey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
    await fetch(`${url}/functions/v1/log-phi-access`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        apikey,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    // never block the UI for audit failures
  }
}
