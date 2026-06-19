import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Loader2, CheckCircle2, AlertCircle, ChevronUp, ChevronDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUploadManager } from "@/hooks/use-upload-manager";
import { uploadManager } from "@/lib/upload-manager";

export function UploadProgressDock() {
  const { items, uploading, queued, done, errored } = useUploadManager();
  const [collapsed, setCollapsed] = useState(false);

  if (items.length === 0) return null;

  const inProgress = uploading + queued;
  const total = items.length;
  const finished = done + errored;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[320px] rounded-lg border bg-card shadow-lg overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b bg-muted/40">
        <div className="flex items-center gap-2 text-sm font-medium">
          {inProgress > 0 ? (
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          ) : errored > 0 ? (
            <AlertCircle className="h-4 w-4 text-destructive" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          )}
          <span>
            {inProgress > 0
              ? `Uploading ${finished} of ${total}…`
              : errored > 0
              ? `${done} done, ${errored} failed`
              : `${done} uploaded`}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? "Expand" : "Collapse"}
          >
            {collapsed ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
          {inProgress === 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => uploadManager.clearFinished()}
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
      {!collapsed && (
        <div className="max-h-64 overflow-y-auto divide-y">
          {items.map((it) => (
            <div key={it.id} className="px-3 py-2 text-xs flex items-center gap-2">
              {it.status === "uploading" && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />}
              {it.status === "queued" && <span className="h-2 w-2 rounded-full bg-muted-foreground/40 shrink-0" />}
              {it.status === "done" && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />}
              {it.status === "error" && <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0" />}
              <div className="flex-1 min-w-0">
                <div className="truncate font-medium">{it.name}</div>
                {it.status === "error" && it.error && (
                  <div className="truncate text-destructive">{it.error}</div>
                )}
                {it.status === "uploading" && it.totalRows && (
                  <div className="text-muted-foreground tabular-nums">
                    {`${(it.processedRows ?? 0).toLocaleString()} / ${it.totalRows.toLocaleString()} rows`}
                  </div>
                )}
                {it.status === "done" && it.sourceFileId && (
                  <Link
                    to="/files/$id"
                    params={{ id: it.sourceFileId }}
                    className="text-primary hover:underline"
                  >
                    Review
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
