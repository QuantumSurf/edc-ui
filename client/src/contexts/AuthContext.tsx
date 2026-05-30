// KMX EDC — Authentication Context
// DB-backed login via POST /api/auth/login (JWT + RBAC role).

import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import axios from "axios";

export interface AuthUser {
  id?: string;
  username: string;          // kept for backwards-compat; set from email local-part
  name: string;
  role: "admin" | "operator" | "viewer";
  email?: string;
  token?: string;
  // Tenant (organization) the user belongs to — drives data isolation.
  tenantId?: string;
  tenantName?: string;
  tenantBpn?: string;
}

interface AuthContextType {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (tenantId: string, password: string) => Promise<boolean>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  login: async () => false,
  logout: () => {},
});

const SESSION_KEY = "kmx-edc-auth";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Restore session on mount
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(SESSION_KEY);
      if (stored) {
        setUser(JSON.parse(stored));
      }
    } catch {}
    setIsLoading(false);
  }, []);

  const login = useCallback(async (tenantId: string, password: string): Promise<boolean> => {
    try {
      const { data } = await axios.post("/api/auth/login", {
        tenantId: tenantId.trim(),
        password,
      });
      const { token, user: u } = data as {
        token: string;
        user: {
          id: string; email: string; name: string; role: "admin" | "operator" | "viewer";
          tenantId?: string; tenantName?: string; tenantBpn?: string;
        };
      };
      const authUser: AuthUser = {
        id: u.id,
        username: u.email.split("@")[0],
        name: u.name,
        role: u.role,
        email: u.email,
        token,
        tenantId: u.tenantId,
        tenantName: u.tenantName,
        tenantBpn: u.tenantBpn,
      };
      setUser(authUser);
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(authUser));
      return true;
    } catch {
      return false;
    }
  }, []);

  const logout = useCallback(() => {
    const tok = user?.token;
    setUser(null);
    sessionStorage.removeItem(SESSION_KEY);
    // Best-effort server notify (no-op on server today)
    if (tok) {
      axios.post("/api/auth/logout", {}, { headers: { Authorization: `Bearer ${tok}` } }).catch(() => {});
    }
  }, [user]);

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
