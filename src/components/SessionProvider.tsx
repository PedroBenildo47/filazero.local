"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import type { Membership, SessionUser } from "@/lib/ui";

interface SessionState {
  user: SessionUser | null;
  memberships: Membership[];
  loading: boolean;
  /** Set when the session could not be fetched (e.g. the API is unreachable). */
  error: string | null;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ user: SessionUser; memberships: Membership[] }>(
        "/api/auth/session",
      );
      setUser(data.user);
      setMemberships(data.memberships);
      setError(null);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "NETWORK") {
        // The server is unreachable: keep the UI calm and let the caller retry
        // instead of bouncing the user to the login screen.
        setError(caught.message);
      } else {
        // Unauthenticated (or any other API error): treat as signed out.
        setUser(null);
        setMemberships([]);
        setError(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } finally {
      setUser(null);
      setMemberships([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<SessionState>(
    () => ({ user, memberships, loading, error, refresh, logout }),
    [user, memberships, loading, error, refresh, logout],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSession deve ser usado dentro de <SessionProvider>");
  }
  return context;
}
