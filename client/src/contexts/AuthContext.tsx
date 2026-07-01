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
import { clearRecent } from "@/lib/recentCatalog";
import { postLogout } from "@/services/api";

export interface AuthUser {
  id?: string;
  username: string; // kept for backwards-compat; set from email local-part
  name: string;
  role: "admin" | "operator" | "viewer";
  email?: string;
  // Tenant (organization) the user belongs to — drives data isolation.
  tenantId?: string;
  tenantName?: string;
  tenantBpn?: string;
}

export type LoginResult =
  | "ok"
  | "invalid"
  | "ratelimited"
  | "server"
  | "network";

interface AuthContextType {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (tenantId: string, password: string) => Promise<LoginResult>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  login: async () => "network",
  logout: () => {},
});

const SESSION_KEY = "kmx-edc-auth";

interface ServerUser {
  id: string;
  email: string;
  name: string;
  role: "admin" | "operator" | "viewer";
  tenantId?: string;
  tenantName?: string;
  tenantBpn?: string;
}

/** 서버 사용자 응답(/login·/me)을 클라 AuthUser 로 매핑. username 은 이메일 로컬파트. */
function toAuthUser(u: ServerUser): AuthUser {
  return {
    id: u.id,
    username: u.email.split("@")[0],
    name: u.name,
    role: u.role,
    email: u.email,
    tenantId: u.tenantId,
    tenantName: u.tenantName,
    tenantBpn: u.tenantBpn,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // 세션 복원 — 세션은 httpOnly 쿠키에 있어 클라가 토큰을 직접 읽지 못한다. 따라서
  // (1) sessionStorage 프로필로 즉시 UI 를 복원(낙관적)하고,
  // (2) GET /api/auth/me 로 쿠키 세션을 서버에 검증한다 — 200 이면 최신 프로필로 갱신,
  //     401/무효면 로그아웃 상태로 정리. bare axios 사용(응답 인터셉터 우회 — 기대된 401).
  useEffect(() => {
    let cancelled = false;
    try {
      const stored = sessionStorage.getItem(SESSION_KEY);
      if (stored) setUser(JSON.parse(stored) as AuthUser);
    } catch {}
    axios
      .get("/api/auth/me", { withCredentials: true })
      .then(({ data }) => {
        if (cancelled) return;
        const profile = toAuthUser(data as ServerUser);
        setUser(profile);
        try {
          sessionStorage.setItem(SESSION_KEY, JSON.stringify(profile));
        } catch {}
      })
      .catch(() => {
        if (cancelled) return;
        setUser(null);
        try {
          sessionStorage.removeItem(SESSION_KEY);
        } catch {}
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(
    async (tenantId: string, password: string): Promise<LoginResult> => {
      try {
        // withCredentials: 서버가 내려주는 Set-Cookie(httpOnly 세션 + CSRF)를 저장하게 한다.
        const { data } = await axios.post(
          "/api/auth/login",
          { tenantId: tenantId.trim(), password },
          { withCredentials: true }
        );
        const { user: u } = data as { user: ServerUser };
        const authUser = toAuthUser(u);
        setUser(authUser);
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(authUser));
        return "ok";
      } catch (err) {
        // 실패 원인 구분 — 네트워크/서버 장애를 "비밀번호 틀림"으로 오인하지 않도록.
        const status = (err as { response?: { status?: number } })?.response
          ?.status;
        if (status === 401 || status === 403) return "invalid";
        if (status === 429) return "ratelimited";
        if (typeof status === "number" && status >= 500) return "server";
        return "network";
      }
    },
    []
  );

  const logout = useCallback(() => {
    setUser(null);
    sessionStorage.removeItem(SESSION_KEY);
    // 테넌트 전환/로그아웃 시 이전 테넌트 데이터가 새 세션에 새지 않도록 캐시·UI 상태를 초기화.
    queryClient.clear();
    useConnectorStore.getState().reset();
    clearRecent(); // localStorage 잔존 거래상대(DSP·BPN) 기록 제거
    // 서버 세션 종료(token_version 증가 + 쿠키 삭제). best-effort — 쿠키는 자동 전송된다.
    void postLogout().catch(() => {});
  }, []);

  // api.ts 인터셉터가 401 에 쏘는 만료 신호 — 세션은 이미 비워졌으므로 로컬 상태/캐시/스토어만 정리.
  useEffect(() => {
    const onExpired = () => {
      setUser(null);
      queryClient.clear();
      useConnectorStore.getState().reset();
      clearRecent();
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
