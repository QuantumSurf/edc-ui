// KMX EDC — RoleGate component
// Conditionally render children based on the current user's permission.
// Usage:
//   <RoleGate permission="connector:write"><Button>Delete</Button></RoleGate>
//   <RoleGate permission="vc:write" fallback={<span>권한 없음</span>}>…</RoleGate>

import type { ReactNode } from "react";
import { useCan, type Permission } from "@/lib/rbac";

interface RoleGateProps {
  permission: Permission;
  children: ReactNode;
  fallback?: ReactNode;
}

export function RoleGate({ permission, children, fallback = null }: RoleGateProps) {
  const allowed = useCan(permission);
  return <>{allowed ? children : fallback}</>;
}
