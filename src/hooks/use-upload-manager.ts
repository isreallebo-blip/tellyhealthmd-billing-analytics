import { useSyncExternalStore } from "react";
import { uploadManager, type UploadItem } from "@/lib/upload-manager";

export function useUploadManager() {
  const state = useSyncExternalStore(
    uploadManager.subscribe,
    uploadManager.getState,
    uploadManager.getState,
  );
  return {
    items: state.items,
    active: state.active,
    queued: state.items.filter((i) => i.status === "queued").length,
    uploading: state.items.filter((i) => i.status === "uploading").length,
    done: state.items.filter((i) => i.status === "done").length,
    errored: state.items.filter((i) => i.status === "error").length,
  };
}

export type { UploadItem };
