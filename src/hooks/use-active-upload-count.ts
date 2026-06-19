import { useSyncExternalStore } from "react";
import { uploadManager } from "@/lib/upload-manager";

/**
 * Returns the number of files currently queued or uploading in the local
 * background upload manager.
 */
export function useActiveUploadCount(): number {
  const state = useSyncExternalStore(uploadManager.subscribe, uploadManager.getState, uploadManager.getState);
  return state.items.filter((item) => item.status === "queued" || item.status === "uploading").length;
}
