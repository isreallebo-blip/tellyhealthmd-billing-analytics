import { useState } from "react";
import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import {
  Activity, LayoutDashboard, Users, Settings, BookOpen, LogOut,
  Upload, Sparkles, Brain, Loader2, FileText, Tags, Download, Layers, ShieldCheck, Bell, BellRing,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import type { Profile } from "@/hooks/use-auth";
import { useActiveUploadCount } from "@/hooks/use-active-upload-count";
import { Button } from "@/components/ui/button";
import { uploadManager } from "@/lib/upload-manager";
import { toast } from "sonner";

const buildMainItems = (isAdmin: boolean) => [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Upload Data", url: "/upload", icon: Upload },
  { title: "Files", url: "/files", icon: FileText },
  { title: "Exports", url: "/exports", icon: Download },
  { title: "AI Insights", url: "/ai-insights", icon: Sparkles },
  { title: "AI Training", url: "/ai-training", icon: Brain },
  { title: "Notifications", url: "/notifications", icon: Bell },
  { title: "CPT Reference", url: isAdmin ? "/admin/cpt" : "/cpt-reference", icon: BookOpen },
];

const adminItems = [
  { title: "User Management", url: "/admin/users", icon: Users },
  { title: "Field Registry", url: "/admin/fields", icon: Tags },
  { title: "Mapping Templates", url: "/admin/templates", icon: Layers },
  { title: "Alert Rules", url: "/admin/alerts", icon: BellRing },
  { title: "Access Audit", url: "/admin/audit", icon: ShieldCheck },
];


const settingsItem = { title: "Settings", url: "/settings", icon: Settings };

export function AppSidebar({ profile }: { profile: Profile | null }) {
  const [signingOut, setSigningOut] = useState(false);
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const navigate = useNavigate();
  const isAdmin = profile?.role === "admin";
  const activeUploads = useActiveUploadCount();
  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      uploadManager.cancelAll();
      void supabase.removeAllChannels();
      const signOutPromise = supabase.auth.signOut();
      const timeoutPromise = new Promise((resolve) => setTimeout(resolve, 1500));
      await Promise.race([signOutPromise, timeoutPromise]);
      await supabase.auth.signOut({ scope: "local" });
      toast.success("Signed out");
    } catch (e) {
      console.error("Sign out error:", e);
    } finally {
      navigate({ to: "/auth", replace: true });
    }
  }

  const isActive = (url: string) => (url === "/" ? pathname === "/" : pathname.startsWith(url));

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-64 shrink-0 bg-sidebar text-sidebar-foreground flex-col min-h-screen">
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

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          <NavGroup label="Workspace">
            {buildMainItems(isAdmin).map((i) => (
              <NavLink
                key={i.url}
                url={i.url}
                icon={i.icon}
                active={isActive(i.url)}
                badge={i.url === "/upload" && activeUploads > 0 ? (
                  <span className="ml-auto flex items-center gap-1 text-[10px] font-medium text-amber-300">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {activeUploads} uploading
                  </span>
                ) : null}
              >
                {i.title}
              </NavLink>
            ))}
          </NavGroup>


          {isAdmin && (
            <NavGroup label="Administration">
              {adminItems.map((i) => (
                <NavLink key={i.url} url={i.url} icon={i.icon} active={isActive(i.url)}>
                  {i.title}
                </NavLink>
              ))}
            </NavGroup>
          )}

          <NavGroup label="Account">
            <NavLink url={settingsItem.url} icon={settingsItem.icon} active={isActive(settingsItem.url)}>
              {settingsItem.title}
            </NavLink>
          </NavGroup>
        </nav>

        <div className="px-3 py-4 border-t border-sidebar-border">
          <div className="px-2 mb-3">
            <div className="text-sm font-medium truncate">{profile?.full_name || profile?.email}</div>
            <div className="text-xs text-sidebar-foreground/60 capitalize">{profile?.role}</div>
          </div>
          <Button
            variant="ghost"
            className="w-full justify-start text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            onClick={signOut} disabled={signingOut}
          >
            {signingOut ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <LogOut className="h-4 w-4 mr-2" />}
            {signingOut ? "Signing out..." : "Sign out"}
          </Button>
        </div>
      </aside>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-sidebar text-sidebar-foreground border-t border-sidebar-border">
        <div className="grid grid-cols-5">
          <MobileTab url="/" icon={LayoutDashboard} active={isActive("/")} label="Home" />
          <MobileTab url="/upload" icon={Upload} active={isActive("/upload")} label="Upload" />
          <MobileTab url="/ai-insights" icon={Sparkles} active={isActive("/ai-insights")} label="Insights" />
          <MobileTab url="/cpt-reference" icon={BookOpen} active={isActive("/cpt-reference")} label="CPT" />
          <MobileTab url="/settings" icon={Settings} active={isActive("/settings")} label="More" />
        </div>
      </nav>
    </>
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
  url, icon: Icon, active, children, badge,
}: {
  url: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  children: React.ReactNode;
  badge?: React.ReactNode;
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
      {badge}
    </Link>
  );
}

function MobileTab({
  url, icon: Icon, active, label,
}: {
  url: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  label: string;
}) {
  return (
    <Link
      to={url}
      className={[
        "flex flex-col items-center justify-center py-2.5 text-[10px] font-medium gap-1 transition-colors",
        active ? "text-sidebar-primary-foreground bg-sidebar-primary/90" : "text-sidebar-foreground/70",
      ].join(" ")}
    >
      <Icon className="h-5 w-5" />
      <span>{label}</span>
    </Link>
  );
}
