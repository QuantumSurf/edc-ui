// KMX EDC — Client-side RBAC permission map
// Keep this in sync with server-side route guards in server/routes/*.ts

import { useAuth } from "@/contexts/AuthContext";

export type Role = "admin" | "operator" | "viewer";

export type Permission =
  | "connector:write" // register/update/delete connectors
  | "connector:test" // test-connection (mirrors server operatorOrAdmin)
  | "vc:write" // add/update/delete/renew verifiable credentials
  | "resource:write" // asset / policy / offering CRUD
  | "transaction:write" // negotiation / transfer start/terminate/complete
  | "read"; // any GET/list endpoint (baseline)

export const PERMISSIONS: Record<Permission, readonly Role[]> = {
  "connector:write": ["admin"],
  "connector:test": ["admin", "operator"],
  "vc:write": ["admin"],
  "resource:write": ["admin", "operator"],
  "transaction:write": ["admin", "operator"],
  read: ["admin", "operator", "viewer"],
};

/** Pure helper — no React hooks. Useful in event handlers or utilities. */
export function can(role: Role | undefined | null, perm: Permission): boolean {
  if (!role) return false;
  return PERMISSIONS[perm].includes(role);
}

/** React hook: returns true when the current user has the permission. */
export function useCan(perm: Permission): boolean {
  const { user } = useAuth();
  return can(user?.role, perm);
}

/** React hook: returns the current user's role (or null). */
export function useRole(): Role | null {
  const { user } = useAuth();
  return user?.role ?? null;
}
