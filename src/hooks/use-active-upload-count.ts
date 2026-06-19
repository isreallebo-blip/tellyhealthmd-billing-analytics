import { useSyncExternalStore } from "react";
import { uploadManager } from "@/lib/upload-manager";

/**
 * Returns the number of upload_jobs in 'queued' or 'processing' state
 * for the current user. Subscribes to realtime updates.
 */
export function useActiveUploadCount(): number {
  const state = useSyncExternalStore(uploadManager.subscribe, uploadManager.getState, uploadManager.getState);
  return state.items.filter((item) => item.status === "queued" || item.status === "uploading").length;
}
