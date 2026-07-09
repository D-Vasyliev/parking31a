import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { SessionUser, MeResult } from "../shared/api";
import { apiGet, apiPost } from "./api";

interface AuthContextValue {
  user: SessionUser | null;
  loading: boolean;
  setUser: (u: SessionUser | null) => void;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    const r = await apiGet<MeResult>("/api/auth/me");
    setUser(r.ok && r.data ? r.data.user : null);
    setLoading(false);
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function logout() {
    await apiPost("/api/auth/logout");
    setUser(null);
  }

  return <AuthContext.Provider value={{ user, loading, setUser, refresh, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth використано поза AuthProvider");
  return ctx;
}
