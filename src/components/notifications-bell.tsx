import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Bell, CheckCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

type N = {
  id: string;
  title: string;
  body: string | null;
  severity: "info" | "warning" | "critical";
  link: string | null;
  read_at: string | null;
  created_at: string;
};

const sevClass: Record<N["severity"], string> = {
  info: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  warning: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  critical: "bg-destructive/15 text-destructive",
};

export function NotificationsBell() {
  const { session } = useAuth();
  const [items, setItems] = useState<N[]>([]);
  const [open, setOpen] = useState(false);

  async function load() {
    if (!session) return;
    const { data } = await supabase
      .from("notifications" as any)
      .select("id,title,body,severity,link,read_at,created_at")
      .order("created_at", { ascending: false })
      .limit(20);
    setItems((data ?? []) as unknown as N[]);
  }

  useEffect(() => {
    if (!session) return;
    load();
    const ch = supabase
      .channel(`notif-${session.user.id}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${session.user.id}` },
        () => load(),
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id]);

  const unread = items.filter((i) => !i.read_at).length;

  async function markRead(id: string) {
    await supabase.from("notifications" as any).update({ read_at: new Date().toISOString() }).eq("id", id);
  }
  async function markAll() {
    if (!session) return;
    await supabase.from("notifications" as any)
      .update({ read_at: new Date().toISOString() })
      .is("read_at", null).eq("user_id", session.user.id);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] rounded-full bg-destructive text-destructive-foreground text-[10px] font-semibold flex items-center justify-center px-1">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <div className="font-medium text-sm">Notifications</div>
          <div className="flex items-center gap-1">
            {unread > 0 && (
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={markAll}>
                <CheckCheck className="h-3.5 w-3.5 mr-1" />Mark all read
              </Button>
            )}
            <Button size="sm" variant="ghost" className="h-7 text-xs" asChild>
              <Link to="/notifications" onClick={() => setOpen(false)}>View all</Link>
            </Button>
          </div>
        </div>
        <ScrollArea className="max-h-96">
          {items.length === 0 ? (
            <div className="px-4 py-8 text-sm text-muted-foreground text-center">You're all caught up.</div>
          ) : (
            <ul className="divide-y">
              {items.map((n) => {
                const Inner = (
                  <div className="flex gap-3 items-start">
                    <Badge className={`mt-0.5 ${sevClass[n.severity]}`} variant="secondary">{n.severity}</Badge>
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm ${n.read_at ? "text-muted-foreground" : "font-medium"}`}>{n.title}</div>
                      {n.body && <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</div>}
                      <div className="text-[10px] text-muted-foreground mt-1">{new Date(n.created_at).toLocaleString()}</div>
                    </div>
                  </div>
                );
                return (
                  <li key={n.id} className={`px-3 py-2.5 ${n.read_at ? "" : "bg-primary/5"}`}>
                    {n.link ? (
                      <Link to={n.link} onClick={() => { markRead(n.id); setOpen(false); }} className="block hover:bg-muted/40 -mx-3 px-3 py-1 rounded">
                        {Inner}
                      </Link>
                    ) : (
                      <button onClick={() => markRead(n.id)} className="block w-full text-left hover:bg-muted/40 -mx-3 px-3 py-1 rounded">
                        {Inner}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
