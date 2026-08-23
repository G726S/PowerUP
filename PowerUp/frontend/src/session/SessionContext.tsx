import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import * as api from "../api/client";
import { ApiError } from "../api/client";
import { SpinnerIcon } from "../components/icons";

/** Genuinely unrecoverable -- the backend explicitly said this session_id
 * doesn't exist, so there's nothing to retry. Any other failure (network
 * error, backend mid-restart, 500) is treated as transient below. */
function isDefinitelyGone(e: unknown): boolean {
  return e instanceof ApiError && e.status === 404;
}

const STORAGE_KEY = "powerup_session_id";

const SessionContext = createContext<string | null>(null);

/** Resolves a session_id once at app startup -- reusing whatever's in
 * localStorage if the backend still recognizes it (so a page reload or a
 * server restart-and-resume doesn't lose the student's courses/progress),
 * otherwise minting a fresh one. Everything under the app tree can read it
 * via useSessionId() instead of threading it through every prop. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        try {
          await api.checkSession(stored);
          if (!cancelled) setSessionId(stored);
          return;
        } catch (e) {
          if (!isDefinitelyGone(e)) {
            // Backend unreachable, mid-restart, or some other transient
            // failure -- NEVER silently discard a stored session_id over
            // this, or a page reload during a brief backend restart would
            // permanently orphan a real session (and everything in it)
            // just because one health check happened to lose the race.
            // Surface a retryable error instead and leave localStorage
            // untouched so the next reload can recover the real session.
            if (!cancelled) {
              setError(
                e instanceof Error
                  ? `Couldn't verify your saved session -- ${e.message}`
                  : "Couldn't verify your saved session.",
              );
            }
            return;
          }
          // stored session_id genuinely doesn't exist (404) -- fall through and mint a new one
        }
      }
      try {
        const { session_id } = await api.createSession();
        // Guard the localStorage write too, not just the state update -- in
        // React StrictMode (dev only) this effect runs twice, and without
        // this check a discarded first attempt can still win the race and
        // leave localStorage pointing at a session_id the app was never
        // actually using in memory, so a later reload picks up an empty
        // "ghost" session instead of the real one.
        if (cancelled) return;
        localStorage.setItem(STORAGE_KEY, session_id);
        setSessionId(session_id);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't reach the backend.");
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="font-mono text-sm font-bold text-[var(--color-ink)]">COULDN'T CONNECT TO THE BACKEND</p>
        <p className="font-mono text-xs text-[var(--color-muted)]">{error}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-2 rounded-lg border-2 border-[var(--color-ink)] bg-[var(--color-pink)] px-4 py-2 font-mono text-sm font-bold text-white shadow-[var(--shadow-brutal-sm)]"
        >
          RETRY
        </button>
      </div>
    );
  }

  if (!sessionId) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <SpinnerIcon className="h-6 w-6 text-[var(--color-ink)]" />
      </div>
    );
  }

  return <SessionContext.Provider value={sessionId}>{children}</SessionContext.Provider>;
}

export function useSessionId(): string {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSessionId must be used within a SessionProvider");
  return ctx;
}
