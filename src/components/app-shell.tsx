import { useEffect, type ReactNode } from "react";
import { useNavigate, Link } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { AppSidebar } from "@/components/app-sidebar";
import { NotificationsBell } from "@/components/notifications-bell";
import { UploadProgressDock } from "@/components/upload-progress-dock";
import { Skeleton } from "@/components/ui/skeleton";

export function AppShell({ children, adminOnly = false }: { children: ReactNode; adminOnly?: boolean }) {
  const { session, profile, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !session) navigate({ to: "/auth" });
  }, [loading, session, navigate]);

  useEffect(() => {
    if (adminOnly && profile && profile.role !== "admin") navigate({ to: "/" });
  }, [adminOnly, profile, navigate]);

  if (loading || !session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="space-y-3 w-64">
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-background">
      <AppSidebar profile={profile} />
      <main className="flex-1 min-w-0 pb-16 md:pb-0">{children}</main>
      {/* UploadProgressDock removed — progress now shows inline in the Files table */}
    </div>
  );
}


export function PageHeader({
  title, description, actions, breadcrumbs,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  breadcrumbs?: { label: string; to?: string }[];
}) {
  return (
    <div className="border-b bg-card">
      <div className="px-4 md:px-8 py-5 md:py-6 flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div className="min-w-0">
          {breadcrumbs && breadcrumbs.length > 0 && (
            <nav aria-label="Breadcrumb" className="mb-1.5 text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
              {breadcrumbs.map((b, i) => (
                <span key={i} className="flex items-center gap-1.5">
                  {b.to ? (
                    <Link to={b.to} className="hover:text-foreground transition-colors">{b.label}</Link>
                  ) : (
                    <span>{b.label}</span>
                  )}
                  {i < breadcrumbs.length - 1 && <span className="text-muted-foreground/50">/</span>}
                </span>
              ))}
            </nav>
          )}
          <h1 className="text-xl md:text-2xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {actions}
          <NotificationsBell />
        </div>
      </div>
    </div>
  );
}

export function EmptyState({
  icon: Icon, title, description, action,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-6">
      <div className="h-12 w-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-4">
        <Icon className="h-6 w-6" />
      </div>
      <h3 className="font-semibold text-base">{title}</h3>
      {description && <p className="text-sm text-muted-foreground mt-1.5 max-w-sm">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
