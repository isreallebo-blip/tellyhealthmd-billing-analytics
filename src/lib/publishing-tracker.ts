// Tracks source files that the user has clicked "Approve & Publish" on.
// The approve edge function returns immediately and finishes the heavy
// claims_raw insert in the background, so the UI needs a transient
// "Publishing…" indicator until the row flips to "approved" via realtime.
//
// State persists in sessionStorage so navigating from the file detail page
// back to /files keeps the indicator visible.

const STORAGE_KEY = "publishing-source-files";
const MAX_AGE_MS = 15 * 60 * 1000; // auto-clear after 15 minutes

type Entry = { id: string; startedAt: number };

const listeners = new Set<() => void>();
let entries: Entry[] = load();

function load(): Entry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as Entry[];
    const now = Date.now();
    return Array.isArray(arr) ? arr.filter((e) => e && e.id && now - e.startedAt < MAX_AGE_MS) : [];
  } catch { return []; }
}

function persist() {
  try { window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(entries)); } catch {}
  listeners.forEach((l) => l());
}

export const publishingTracker = {
  mark(id: string) {
    entries = [...entries.filter((e) => e.id !== id), { id, startedAt: Date.now() }];
    persist();
  },
  clear(id: string) {
    const before = entries.length;
    entries = entries.filter((e) => e.id !== id);
    if (entries.length !== before) persist();
  },
  isPublishing(id: string): boolean {
    return entries.some((e) => e.id === id && Date.now() - e.startedAt < MAX_AGE_MS);
  },
  subscribe(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb); }; },
  getSnapshot(): Entry[] { return entries; },
};
