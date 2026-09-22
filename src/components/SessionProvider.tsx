"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import type { Membership, SessionUser } from "@/lib/ui";

interface SessionState {
  user: SessionUser | null;
  memberships: Membership[];
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api<{ user: SessionUser; memberships: Membership[] }>(
        "/api/auth/session",
      );
      setUser(data.user);
      setMemberships(data.memberships);
    } catch (error) {
      if (error instanceof ApiError && error.isUnauthenticated) {
        setUser(null);
        setMemberships([]);
      } else {
        setUser(null);
        setMemberships([]);
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
    () => ({ user, memberships, loading, refresh, logout }),
    [user, memberships, loading, refresh, logout],
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
