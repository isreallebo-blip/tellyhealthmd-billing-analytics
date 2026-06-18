import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { Activity, LayoutDashboard, FileText, Users, Settings, BookOpen, LogOut, Stethoscope, Upload, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Profile } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";

const items = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Claims", url: "/claims", icon: FileText },
  { title: "Upload", url: "/upload", icon: Upload },
  { title: "CPT Reference", url: "/cpt-reference", icon: BookOpen },
  { title: "AI Training", url: "/ai-training", icon: Sparkles },
];

const adminItems = [
  { title: "Users", url: "/admin/users", icon: Users },
  { title: "CPT Manager", url: "/admin/cpt", icon: Stethoscope },
  { title: "Settings", url: "/admin/settings", icon: Settings },
];

export function AppSidebar({ profile }: { profile: Profile | null }) {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const navigate = useNavigate();

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  }

  const isActive = (url: string) => (url === "/" ? pathname === "/" : pathname.startsWith(url));

  return (
    <aside className="w-64 shrink-0 bg-sidebar text-sidebar-foreground flex flex-col min-h-screen">
      <div className="px-5 py-5 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-md bg-white/10 flex items-center justify-center">
            <Activity className="h-5 w-5" />
          </div>
          <div>
            <div className="font-semibold tracking-tight leading-tight">TellyHealthMD</div>
            <div className="text-[11px] uppercase tracking-wider text-sidebar-foreground/60">
              Billing Analytics
            </div>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        <NavGroup label="Workspace">
          {items.map((i) => (
            <NavLink key={i.url} url={i.url} icon={i.icon} active={isActive(i.url)}>
              {i.title}
            </NavLink>
          ))}
        </NavGroup>

        {profile?.role === "admin" && (
          <NavGroup label="Administration">
            {adminItems.map((i) => (
              <NavLink key={i.url} url={i.url} icon={i.icon} active={isActive(i.url)}>
                {i.title}
              </NavLink>
            ))}
          </NavGroup>
        )}
      </nav>

      <div className="px-3 py-4 border-t border-sidebar-border">
        <div className="px-2 mb-3">
          <div className="text-sm font-medium truncate">{profile?.full_name || profile?.email}</div>
          <div className="text-xs text-sidebar-foreground/60 capitalize">{profile?.role}</div>
        </div>
        <Button
          variant="ghost"
          className="w-full justify-start text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          onClick={signOut}
        >
          <LogOut className="h-4 w-4 mr-2" />
          Sign out
        </Button>
      </div>
    </aside>
  );
}

function NavGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="px-3 py-2 text-[11px] uppercase tracking-wider text-sidebar-foreground/50 font-medium">
        {label}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function NavLink({
  url,
  icon: Icon,
  active,
  children,
}: {
  url: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={url}
      className={[
        "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
        active
          ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
          : "text-sidebar-foreground/85 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
      ].join(" ")}
    >
      <Icon className="h-4 w-4" />
      <span>{children}</span>
    </Link>
  );
}
