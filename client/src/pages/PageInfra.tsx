// Connector Hub — Infrastructure / Operations Page
// 라이브 데이터만: Platform PostgreSQL via /api/platform/postgres/*.
// (과거의 하드코딩 demo 카드 — k8s/ingress/resource/hikari/flyway/lease — 는 제거됨.)

import { useI18n } from "@/i18n";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  Badge,
  SectionHdr,
  MonoText,
  RefreshButton,
  ListEmpty,
} from "@/components/ui-kmx";
import { Database, Loader2 } from "lucide-react";
import {
  fetchPgOverview,
  fetchPgDatabases,
  fetchPgLocks,
  type PgOverviewResp as PgOverview,
  type PgDatabasesResp as PgDatabases,
  type PgLocksResp as PgLocks,
} from "@/services/api";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatUptime(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export default function PageInfra() {
  const { t } = useI18n();

  // Live platform PostgreSQL data (조회 실패 시 재시도 없음 — 빈 상태로 처리).
  const overviewQuery = useQuery<PgOverview>({
    queryKey: ["platform-pg", "overview"],
    queryFn: fetchPgOverview,
    retry: false,
    refetchInterval: 60_000,
  });
  const databasesQuery = useQuery<PgDatabases>({
    queryKey: ["platform-pg", "databases"],
    queryFn: fetchPgDatabases,
    retry: false,
    refetchInterval: 30_000,
  });
  const locksQuery = useQuery<PgLocks>({
    queryKey: ["platform-pg", "locks"],
    queryFn: fetchPgLocks,
    retry: false,
    refetchInterval: 15_000,
  });

  const isLive =
    !!overviewQuery.data || !!databasesQuery.data?.databases?.length;
  const isFetchingAny =
    overviewQuery.isFetching ||
    databasesQuery.isFetching ||
    locksQuery.isFetching;
  const refetchAll = () => {
    overviewQuery.refetch();
    databasesQuery.refetch();
    locksQuery.refetch();
  };

  return (
    <>
      <SectionHdr
        action={
          <RefreshButton
            onRefresh={refetchAll}
            busy={isFetchingAny}
            label={t.common.refresh}
          />
        }
        subtitle={t.pageSubtitles.infra}
      >
        {t.infra.title}
      </SectionHdr>

      {isLive ? (
        <Card title="Platform PostgreSQL (shared)">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Overview */}
            <div>
              <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Cluster
              </div>
              {overviewQuery.data ? (
                <div className="space-y-1.5">
                  <div className="text-[12px]">
                    <span className="text-muted-foreground">Version: </span>
                    <MonoText className="text-[12px]">
                      {overviewQuery.data.version.split(" on ")[0]}
                    </MonoText>
                  </div>
                  <div className="text-[12px]">
                    <span className="text-muted-foreground">Uptime: </span>
                    <span className="font-medium">
                      {formatUptime(overviewQuery.data.uptimeSeconds)}
                    </span>
                  </div>
                  <div className="text-[12px]">
                    <span className="text-muted-foreground">
                      max_connections:{" "}
                    </span>
                    <span className="font-medium">
                      {overviewQuery.data.settings.max_connections ?? "—"}
                    </span>
                  </div>
                  <div className="text-[12px]">
                    <span className="text-muted-foreground">
                      shared_buffers:{" "}
                    </span>
                    <span className="font-medium">
                      {overviewQuery.data.settings.shared_buffers ?? "—"}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="text-[12px] text-muted-foreground">Loading…</div>
              )}
            </div>

            {/* Databases */}
            <div className="md:col-span-2">
              <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Databases (DB-per-connector)
              </div>
              {databasesQuery.data?.databases?.length ? (
                <div className="space-y-1.5">
                  {databasesQuery.data.databases.map(db => (
                    <div
                      key={db.name}
                      className="flex items-center justify-between text-[12px] border-b border-border last:border-b-0 pb-1.5"
                    >
                      <MonoText className="text-[12px] font-semibold">
                        {db.name}
                      </MonoText>
                      <div className="flex items-center gap-3 text-muted-foreground">
                        <span>{formatBytes(db.sizeBytes)}</span>
                        <Badge variant={db.connections > 0 ? "blue" : "gray"}>
                          {db.connections} conn
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-[12px] text-muted-foreground">Loading…</div>
              )}
            </div>
          </div>

          {/* Locks */}
          {locksQuery.data && (
            <div className="mt-4 pt-3 border-t border-border flex items-center gap-4 text-[12px]">
              <span className="text-muted-foreground">Locks:</span>
              <Badge variant="green">{locksQuery.data.granted} granted</Badge>
              <Badge variant={locksQuery.data.waiting > 0 ? "amber" : "gray"}>
                {locksQuery.data.waiting} waiting
              </Badge>
            </div>
          )}
        </Card>
      ) : isFetchingAny ? (
        <Card>
          <div className="flex items-center justify-center py-10 gap-2 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-[13px]">{t.common.loading}</span>
          </div>
        </Card>
      ) : (
        <Card>
          <ListEmpty icon={<Database />} message={t.infra.unavailable} />
        </Card>
      )}
    </>
  );
}
