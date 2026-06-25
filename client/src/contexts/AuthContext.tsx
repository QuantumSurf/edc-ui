// KMX EDC — Authentication Context
// DB-backed login via POST /api/auth/login (JWT + RBAC role).

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
} from "react";
import axios from "axios";
import { queryClient } from "@/lib/queryClient";
import { useConnectorStore } from "@/stores/connectorStore";

export interface AuthUser {
  id?: string;
  username: string; // kept for backwards-compat; set from email local-part
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

/** JWT payload 의 exp(초)를 디코드해 만료 여부를 판정. 디코드 실패 시 만료로 보지 않음(서버 401 이 최종 판정). */
function isTokenExpired(token?: string): boolean {
  if (!token) return false;
  try {
    const payload = token.split(".")[1];
    if (!payload) return false;
    const json = JSON.parse(
      atob(payload.replace(/-/g, "+").replace(/_/g, "/"))
    );
    const exp = json?.exp;
    if (typeof exp !== "number") return false;
    return exp * 1000 <= Date.now();
  } catch {
    return false;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Restore session on mount
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(SESSION_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as AuthUser;
        // 저장된 토큰이 이미 만료됐으면 복원하지 않는다 — 만료된 셸이 잠깐도 뜨지 않게.
        if (isTokenExpired(parsed.token)) {
          sessionStorage.removeItem(SESSION_KEY);
        } else {
          setUser(parsed);
        }
      }
    } catch {}
    setIsLoading(false);
  }, []);

  const login = useCallback(
    async (tenantId: string, password: string): Promise<boolean> => {
      try {
        const { data } = await axios.post("/api/auth/login", {
          tenantId: tenantId.trim(),
          password,
        });
        const { token, user: u } = data as {
          token: string;
          user: {
            id: string;
            email: string;
            name: string;
            role: "admin" | "operator" | "viewer";
            tenantId?: string;
            tenantName?: string;
            tenantBpn?: string;
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
    },
    []
  );

  const logout = useCallback(() => {
    const tok = user?.token;
    setUser(null);
    sessionStorage.removeItem(SESSION_KEY);
    // 테넌트 전환/로그아웃 시 이전 테넌트 데이터가 새 세션에 새지 않도록 캐시·UI 상태를 초기화.
    queryClient.clear();
    useConnectorStore.getState().reset();
    // Best-effort server notify (no-op on server today)
    if (tok) {
      axios
        .post(
          "/api/auth/logout",
          {},
          { headers: { Authorization: `Bearer ${tok}` } }
        )
        .catch(() => {});
    }
  }, [user]);

  // api.ts 인터셉터가 401 에 쏘는 만료 신호 — 세션은 이미 비워졌으므로 로컬 상태/캐시/스토어만 정리.
  useEffect(() => {
    const onExpired = () => {
      setUser(null);
      queryClient.clear();
      useConnectorStore.getState().reset();
    };
    window.addEventListener("kmx-auth-expired", onExpired);
    return () => window.removeEventListener("kmx-auth-expired", onExpired);
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, isAuthenticated: !!user, isLoading, login, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
