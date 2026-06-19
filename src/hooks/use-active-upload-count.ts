import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

/**
 * Returns the number of upload_jobs in 'queued' or 'processing' state
 * for the current user. Subscribes to realtime updates.
 */
export function useActiveUploadCount(): number {
  const { profile } = useAuth();
  const profileId = profile?.id ?? null;
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!profileId) return;
    let cancelled = false;

    async function refresh() {
      const { count: c } = await supabase
        .from("upload_jobs" as any)
        .select("id", { count: "exact", head: true })
        .eq("user_id", profileId)
        .in("status", ["queued", "processing"]);
      if (!cancelled) setCount(c ?? 0);
    }
    refresh();

    const channel = supabase
      .channel(`upload-jobs-count-${profileId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "upload_jobs", filter: `user_id=eq.${profileId}` },
        () => { refresh(); },
      )
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [profileId]);

  return count;
}
