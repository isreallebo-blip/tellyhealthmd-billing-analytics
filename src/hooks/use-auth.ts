import { useSyncExternalStore } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  role: "admin" | "viewer";
};

type AuthState = {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
};

// ---- Module-level singleton store ----
let state: AuthState = { session: null, user: null, profile: null, loading: true };
const listeners = new Set<() => void>();
let initialized = false;
let profileFetchedFor: string | null = null;
let profileInFlight: Promise<void> | null = null;

function setState(patch: Partial<AuthState>) {
  const next = { ...state, ...patch };
  // Avoid notifying when nothing actually changed (referential).
  if (
    next.session === state.session &&
    next.user === state.user &&
    next.profile === state.profile &&
    next.loading === state.loading
  ) return;
  state = next;
  listeners.forEach((l) => l());
}

async function loadProfile(userId: string) {
  if (profileFetchedFor === userId) return;
  if (profileInFlight) return profileInFlight;
  profileInFlight = (async () => {
    const { data } = await supabase
      .from("profiles")
      .select("id,email,full_name,role")
      .eq("id", userId)
      .maybeSingle();
    profileFetchedFor = userId;
    setState({ profile: (data as Profile | null) ?? null });
  })().finally(() => { profileInFlight = null; });
  return profileInFlight;
}

function applySession(session: Session | null) {
  const user = session?.user ?? null;
  const userIdChanged = (user?.id ?? null) !== (state.user?.id ?? null);
  setState({ session, user });
  if (!user) {
    profileFetchedFor = null;
    setState({ profile: null });
    return;
  }
  if (userIdChanged) {
    profileFetchedFor = null;
    setState({ profile: null });
    void loadProfile(user.id);
  } else if (profileFetchedFor !== user.id) {
    void loadProfile(user.id);
  }
}

function init() {
  if (initialized) return;
  initialized = true;

  supabase.auth.onAuthStateChange((event, session) => {
    // Only react to identity transitions; ignore TOKEN_REFRESHED / INITIAL_SESSION noise.
    if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
      applySession(session);
    } else if (state.user?.id !== (session?.user?.id ?? null)) {
      // Defensive: identity changed via another path
      applySession(session);
    }
  });

  supabase.auth.getSession().then(({ data }) => {
    applySession(data.session);
    setState({ loading: false });
  });
}

function subscribe(cb: () => void) {
  init();
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

const getSnapshot = () => state;

export function useAuth() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
