// 인증 컨텍스트 타입 + 컨텍스트 객체 + 소비 훅.
// Provider(AuthContext.tsx)와 분리해 둔 이유: 컴포넌트 파일이 컴포넌트만
// export 해야 Vite dev HMR(react-refresh)이 상태를 보존한 채 갱신된다.

import { createContext, useContext } from "react";

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
  | "locked"
  | "server"
  | "network";

export interface AuthContextType {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (tenantId: string, password: string) => Promise<LoginResult>;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextType>({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  login: async () => "network",
  logout: () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}
