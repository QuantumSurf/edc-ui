// Connector Hub — Infrastructure / Operations Page
// Design: Clean Slate | Primary: Emerald Green | Theme: Light
// Live data: Platform PostgreSQL via /api/platform/postgres/* (graceful fallback)

import { useI18n } from "@/i18n";
import { useQuery } from "@tanstack/react-query";
import { Card, Badge, SectionHdr, ProgressBar, MonoText, DataSourceBadge, CardTitle } from "@/components/ui-kmx";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import {
  fetchPgOverview, fetchPgDatabases, fetchPgLocks,
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

const HIKARI_DATA_RAW = [
  { key: "hikariActive" as const, value: 8,  color: "#3B82F6" },
  { key: "hikariIdle" as const,   value: 12, color: "#94A3B8" },
  { key: "hikariWait" as const,   value: 2,  color: "#F59E0B" },
  { key: "hikariTotal" as const,  value: 20, color: "#3B82F6" },
];

const LEASE_HEATMAP = [2, 3, 1, 4, 8, 5, 2, 1, 3, 6, 4, 2];

function getLeaseColor(v: number) {
  if (v === 0) return "#DBEAFE";
  if (v <= 3)  return "#93C5FD";
  if (v <= 6)  return "#3B82F6";
  if (v <= 8)  return "#2563EB";
  return "#1D4ED8";
}

export default function PageInfra() {
  const { t } = useI18n();
  const HIKARI_DATA = HIKARI_DATA_RAW.map((d) => ({ ...d, name: t.infra[d.key] }));

  // Live platform PostgreSQL data (graceful fallback — only renders when available)
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

  const isLive = !!overviewQuery.data || !!databasesQuery.data?.databases?.length;

  return (
    <>
      <SectionHdr action={<DataSourceBadge mode={isLive ? "mixed" : "demo"} />}>
        {t.infra.title}
      </SectionHdr>

      {/* Platform PostgreSQL — Live (when available) */}
      {isLive && (
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
                    <span className="font-medium">{formatUptime(overviewQuery.data.uptimeSeconds)}</span>
                  </div>
                  <div className="text-[12px]">
                    <span className="text-muted-foreground">max_connections: </span>
                    <span className="font-medium">{overviewQuery.data.settings.max_connections ?? "—"}</span>
                  </div>
                  <div className="text-[12px]">
                    <span className="text-muted-foreground">shared_buffers: </span>
                    <span className="font-medium">{overviewQuery.data.settings.shared_buffers ?? "—"}</span>
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
                  {databasesQuery.data.databases.map((db) => (
                    <div
                      key={db.name}
                      className="flex items-center justify-between text-[12px] border-b border-border last:border-b-0 pb-1.5"
                    >
                      <MonoText className="text-[12px] font-semibold">{db.name}</MonoText>
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
      )}

      {/* K8s + Ingress + Resources */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card title={<CardTitle badge={<DataSourceBadge mode="demo" />}>{t.infra.k8sDeployments}</CardTitle>}>
          <div className="space-y-0">
            {[
              ["kmx-edc-controlplane", "2/2", "up"],
              ["kmx-edc-dataplane",    "2/2", "up"],
              ["kmx-identityhub",      "1/1", "up"],
              ["kmx-issuerservice",    "1/1", "up"],
              ["kmx-vault",            "1/1", "up"],
            ].map(([n, r, s], i, arr) => (
              <div key={n} className={`flex justify-between items-center py-2 ${i < arr.length - 1 ? "border-b border-border" : ""}`}>
                <span className="text-[12px] text-muted-foreground truncate flex-1 mr-2">{n}</span>
                <Badge variant={s === "up" ? "green" : "red"}>{r}</Badge>
              </div>
            ))}
          </div>
        </Card>

        <Card title={<CardTitle badge={<DataSourceBadge mode="demo" />}>{t.infra.ingressPaths}</CardTitle>}>
          <div className="space-y-0">
            {[
              ["/management → CP:8081",      "up"],
              ["/api/v1/dsp → CP:8283",       "up"],
              ["/api/public → DP:8081",       "up"],
              ["/api/presentation → IH:10001","up"],
              [`/control (8082) — ${t.infra.notExposed}`,    "gray"],
            ].map(([n, s], i, arr) => (
              <div key={n} className={`flex justify-between items-center py-2 ${i < arr.length - 1 ? "border-b border-border" : ""}`}>
                <span className="text-[11px] text-muted-foreground truncate flex-1 mr-2">{n}</span>
                <Badge variant={s === "up" ? "green" : s === "gray" ? "gray" : "red"}>
                  {s === "up" ? t.infra.ok : s === "gray" ? t.infra.internal : t.infra.down}
                </Badge>
              </div>
            ))}
          </div>
        </Card>

        <Card title={<CardTitle badge={<DataSourceBadge mode="demo" />}>{t.infra.resourceUsage}</CardTitle>}>
          <div className="space-y-0">
            {[
              ["CP CPU",    "42%", "green"],
              ["CP Memory", "76%", "amber"],
              ["DP CPU",    "28%", "green"],
              ["DP Memory", "51%", "green"],
              ["IH Memory", "44%", "green"],
            ].map(([n, v, c], i, arr) => (
              <div key={n} className={`py-2 ${i < arr.length - 1 ? "border-b border-border" : ""}`}>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-[12px] text-muted-foreground">{n}</span>
                  <Badge variant={c === "green" ? "green" : c === "amber" ? "amber" : "red"}>{v}</Badge>
                </div>
                <ProgressBar
                  value={parseInt(v)}
                  colorClass={c === "green" ? "bg-blue-500" : c === "amber" ? "bg-amber-500" : "bg-rose-500"}
                />
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* HikariCP Chart (spec 3.3.4: Desktop 200px, Tablet 160px, Mobile gauge card) */}
      <Card title={<CardTitle badge={<DataSourceBadge mode="demo" />}>{t.infra.hikariPool}</CardTitle>}>
        {/* Mobile: gauge numbers */}
        <div className="sm:hidden grid grid-cols-4 gap-2 text-center">
          {HIKARI_DATA.map((d) => (
            <div key={d.name} className="bg-muted rounded-lg p-2">
              <div className="font-display text-lg font-bold kpi-value" style={{ color: d.color }}>{d.value}</div>
              <div className="text-[11px] text-muted-foreground">{d.name}</div>
            </div>
          ))}
        </div>
        {/* Tablet+: bar chart */}
        <div className="hidden sm:block">
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={HIKARI_DATA} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ fontSize: 11, border: "1px solid #BFDBFE", borderRadius: 6 }} />
            <Bar dataKey="value" radius={[3, 3, 0, 0]}>
              {HIKARI_DATA.map((entry, i) => (
                <Cell key={i} fill={entry.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        </div>
      </Card>

      {/* Flyway */}
      <Card title={<CardTitle badge={<DataSourceBadge mode="demo" />}>{t.infra.flywayTitle}</CardTitle>}>
        <div className="space-y-2.5">
          {[
            ["V1__create_lease",        "edc_lease"],
            ["V2__create_asset",        "edc_asset, edc_asset_dataaddress"],
            ["V3__create_policy",       "edc_policy_definitions"],
            ["V4__create_contract_def", "edc_contract_definitions"],
            ["V5__create_negotiation",  "edc_contract_negotiations, agreement"],
            ["V6__create_transfer",     "edc_transfer_process"],
            ["V7__create_edr",          "edc_edr_entry"],
            ["V8__create_dataplane",    "edc_data_plane, instance"],
            ["V9__create_indexes",      "state/ts 인덱스 일괄, GIN"],
          ].map(([v, desc]) => (
            <div key={v} className="flex items-center gap-3 text-[11px]">
              <span className="mono text-[11px] text-muted-foreground w-44 flex-shrink-0">{v}</span>
              <span className="text-muted-foreground flex-1 truncate text-[11px]">{desc}</span>
              <div className="w-24 flex-shrink-0">
                <ProgressBar value={100} colorClass="bg-blue-500" />
              </div>
              <Badge variant="green" className="flex-shrink-0">{t.infra.success}</Badge>
            </div>
          ))}
        </div>
      </Card>

      {/* edc_lease Heatmap (spec 3.3.4: 12cols desktop, 8cols tablet, hidden mobile) */}
      <Card title={<CardTitle badge={<DataSourceBadge mode="demo" />}>{t.infra.leaseHeatmap}</CardTitle>} className="hidden sm:block">
        <div className="grid grid-cols-8 md:grid-cols-12 gap-1.5 mb-3">
          {LEASE_HEATMAP.map((v, i) => (
            <div
              key={i}
              title={`${v} leases`}
              className="h-5 rounded"
              style={{ background: getLeaseColor(v) }}
            />
          ))}
        </div>
        <div className="flex gap-4 text-[11px] text-muted-foreground items-center">
          {[["#DBEAFE", "0"], ["#93C5FD", "1–3"], ["#3B82F6", "4–6"], ["#2563EB", "7–8"], ["#1D4ED8", "9+"]].map(([c, l]) => (
            <span key={l} className="flex items-center gap-1">
              <span className="w-3 h-3 rounded" style={{ background: c }} />
              {l}
            </span>
          ))}
        </div>
      </Card>
    </>
  );
}
