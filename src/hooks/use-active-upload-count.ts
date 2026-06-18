import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

/**
 * Returns the number of upload_jobs in 'queued' or 'processing' state
 * for the current user. Subscribes to realtime updates.
 */
export function useActiveUploadCount(): number {
  const { profile } = useAuth();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;

    async function refresh() {
      const { count: c } = await supabase
        .from("upload_jobs" as any)
        .select("id", { count: "exact", head: true })
        .eq("user_id", profile!.id)
        .in("status", ["queued", "processing"]);
      if (!cancelled) setCount(c ?? 0);
    }
    refresh();

    const channel = supabase
      .channel(`upload-jobs-count-${profile.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "upload_jobs", filter: `user_id=eq.${profile.id}` },
        () => { refresh(); },
      )
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [profile]);

  return count;
}
