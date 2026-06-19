import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { AppShell, PageHeader, EmptyState } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Bell, CheckCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/notifications")({
  head: () => ({
    meta: [
      { title: "Notifications — TellyHealthMD Billing Analytics" },
      { name: "description", content: "Your alerts and notifications inbox." },
    ],
  }),
  component: () => (
    <AppShell>
      <Page />
    </AppShell>
  ),
});

type N = {
  id: string; title: string; body: string | null;
  severity: "info" | "warning" | "critical";
  link: string | null; read_at: string | null; created_at: string;
};

const sevClass: Record<N["severity"], string> = {
  info: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  warning: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  critical: "bg-destructive/15 text-destructive",
};

function Page() {
  const { session } = useAuth();
  const [items, setItems] = useState<N[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("notifications" as any)
      .select("id,title,body,severity,link,read_at,created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    setItems((data ?? []) as unknown as N[]);
    setLoading(false);
  }

  useEffect(() => {
    if (!session) return;
    load();
    const ch = supabase.channel(`notif-page-${session.user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${session.user.id}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [session?.user.id]);

  async function markAll() {
    if (!session) return;
    await supabase.from("notifications" as any)
      .update({ read_at: new Date().toISOString() })
      .is("read_at", null).eq("user_id", session.user.id);
    toast.success("All notifications marked read");
  }

  async function remove(id: string) {
    const { error } = await supabase.from("notifications" as any).delete().eq("id", id);
    if (error) toast.error(error.message);
  }

  const unread = items.filter((n) => !n.read_at).length;

  return (
    <>
      <PageHeader
        title="Notifications"
        description={`${items.length.toLocaleString()} total · ${unread} unread`}
        actions={
          unread > 0 ? (
            <Button onClick={markAll}><CheckCheck className="h-4 w-4 mr-2" />Mark all read</Button>
          ) : null
        }
      />
      <div className="p-8">
        {loading ? (
          <div className="text-muted-foreground">Loading…</div>
        ) : items.length === 0 ? (
          <Card><EmptyState icon={Bell} title="You're all caught up" description="Active alert rules will surface here when something needs your attention." /></Card>
        ) : (
          <Card className="divide-y">
            {items.map((n) => (
              <div key={n.id} className={`p-4 flex items-start gap-3 ${n.read_at ? "" : "bg-primary/5"}`}>
                <Badge className={sevClass[n.severity]} variant="secondary">{n.severity}</Badge>
                <div className="flex-1 min-w-0">
                  <div className={n.read_at ? "text-muted-foreground" : "font-medium"}>{n.title}</div>
                  {n.body && <div className="text-sm text-muted-foreground mt-1">{n.body}</div>}
                  <div className="text-xs text-muted-foreground mt-1">{new Date(n.created_at).toLocaleString()}</div>
                  {n.link && (
                    <Button asChild size="sm" variant="link" className="px-0 h-auto mt-1">
                      <Link to={n.link}>Open</Link>
                    </Button>
                  )}
                </div>
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => remove(n.id)} aria-label="Delete">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </Card>
        )}
      </div>
    </>
  );
}
