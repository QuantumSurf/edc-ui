// 라우트 콘텐츠용 클라이언트 RBAC 가드.
// 서버는 이미 403 으로 막지만(예: EDR 목록은 read 조차 admin/operator — routes/edrs.ts),
// 클라 가드가 없으면 viewer 가 딥링크로 진입 시 403 에러 화면/재시도 루프를 본다.
// 여기서 명확한 "접근 권한 없음" 안내로 대체한다. 보안 경계는 여전히 서버다.
import { ShieldAlert } from "lucide-react";
import { Link } from "wouter";
import { useI18n } from "@/i18n";
import { useRole, type Role } from "@/lib/rbac";

export default function RequireRole({
  roles,
  children,
}: {
  /** 이 페이지를 볼 수 있는 역할 목록(서버 라우트 가드와 동기 유지). */
  roles: readonly Role[];
  children: React.ReactNode;
}) {
  const role = useRole();
  const { t } = useI18n();

  if (role && roles.includes(role)) return <>{children}</>;

  const roleLabel: Record<Role, string> = {
    admin: t.auth.roleAdmin,
    operator: t.auth.roleOperator,
    viewer: t.auth.roleViewer,
  };

  return (
    <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
      <ShieldAlert size={40} className="text-muted-foreground" />
      <h2 className="text-lg font-semibold">{t.auth.pageForbiddenTitle}</h2>
      <p className="text-sm text-muted-foreground max-w-md">
        {t.auth.pageForbiddenDesc}
      </p>
      <p className="text-sm">
        <span className="text-muted-foreground">{t.auth.requiredRoles}: </span>
        <span className="font-medium">
          {roles.map(r => roleLabel[r]).join(", ")}
        </span>
      </p>
      <Link href="/fleet" className="mt-2 text-sm text-primary hover:underline">
        {t.auth.backToFleet}
      </Link>
    </div>
  );
}
