// Connector Hub — Single Connector Dashboard
// Design: Admin Console style | Large KPI numbers + white cards + line charts

import { type Connector } from "@/lib/data";
import { useI18n } from "@/i18n";
import { useQuery } from "@tanstack/react-query";
import { fetchNegotiations, fetchTransfers, fetchTrend } from "@/services";
import {
  Card,
  StateBadge,
  MonoText,
  SectionHdr,
  KpiCard,
  CardTitle,
  ViewAllLink,
  ListError,
  ListEmpty,
} from "@/components/ui-kmx";
import {
  Package,
  ArrowRightLeft,
  Activity,
  TrendingUp,
  LayoutDashboard,
  FileText,
} from "lucide-react";
import { useMemo } from "react";
import {
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
} from "recharts";

const FSM_COLORS: Record<string, string> = {
  FINALIZED: "#10B981",
  REQUESTING: "#3B82F6",
  OFFERED: "#0EA5E9",
  ACCEPTED: "#14B8A6",
  AGREED: "#14B8A6",
  VERIFIED: "#6366F1",
  TERMINATED: "#EF4444",
};

interface PageDashboardProps {
  conn: Connector;
  onNav: (page: string) => void;
}

export default function PageDashboard({ conn, onNav }: PageDashboardProps) {
  const { t } = useI18n();

  const {
    data: negotiations = [],
    isError: negError,
    refetch: negRefetch,
    isFetching: negFetching,
  } = useQuery({
    queryKey: ["negotiations", conn.id],
    queryFn: () => fetchNegotiations(conn.id),
    refetchInterval: 30_000,
  });

  const {
    data: transfers = [],
    isError: transfersError,
    refetch: transfersRefetch,
    isFetching: transfersFetching,
  } = useQuery({
    queryKey: ["transfers", conn.id],
    queryFn: () => fetchTransfers(conn.id),
    refetchInterval: 30_000,
  });

  const { data: trendData = [] } = useQuery({
    queryKey: ["stats-trend", conn.id],
    queryFn: () => fetchTrend(conn.id, 24),
    refetchInterval: 60_000, // 1분마다 갱신
  });

  // 전송 통계: 완료(COMPLETED) / 진행 중(REQUESTING·STARTED·SUSPENDED)
  const transferStats = useMemo(() => {
    let done = 0,
      active = 0;
    for (const tr of transfers) {
      if (tr?.name === "COMPLETED") done++;
      else if (
        tr?.name === "REQUESTING" ||
        tr?.name === "STARTED" ||
        tr?.name === "SUSPENDED"
      )
        active++;
    }
    return { done, active };
  }, [transfers]);

  // FSM 분포: 실제 negotiations 데이터에서 집계
  const pieData = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const n of negotiations) {
      counts[n.name] = (counts[n.name] ?? 0) + 1;
    }
    return Object.entries(counts)
      .filter(([, v]) => v > 0)
      .map(([name, value]) => ({
        name,
        value,
        color: FSM_COLORS[name] ?? "#94A3B8",
      }))
      .sort((a, b) => b.value - a.value);
  }, [negotiations]);

  return (
    <>
      {/* Page Title */}
      <SectionHdr icon={<LayoutDashboard className="w-5 h-5 text-primary" />}>
        {t.nav.dashboard}
      </SectionHdr>

      {/* KPI Row — KpiCard 통일 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <KpiCard
          icon={
            <Package className="w-[18px] h-[18px] text-blue-600 dark:text-blue-400" />
          }
          iconBg="bg-blue-50 dark:bg-blue-500/10"
          value={conn.assets}
          title={t.dashboard.assets}
          sub={t.dashboard.includingOfferings}
          trend="up"
          onClick={() => onNav(`/connectors/${conn.id}/assets`)}
          ariaLabel={`${t.dashboard.assets} ${conn.assets}`}
        />
        <KpiCard
          icon={
            <ArrowRightLeft className="w-[18px] h-[18px] text-sky-600 dark:text-sky-400" />
          }
          iconBg="bg-sky-50 dark:bg-sky-500/10"
          value={transfersError ? "—" : transfers.length}
          title={t.dashboard.dataTransfers}
          sub={t.dashboard.completedInProgress(
            transferStats.done,
            transferStats.active
          )}
          valueColor="text-sky-600 dark:text-sky-400"
          trend="up"
          onClick={() => onNav(`/connectors/${conn.id}/transfer`)}
          ariaLabel={t.dashboard.dataTransfers}
        />
      </div>

      {/* Charts Row — matching image line chart style */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
        {/* Line Chart — RPM/Latency style */}
        <Card
          title={
            <CardTitle
              icon={<TrendingUp className="w-3.5 h-3.5 text-blue-500" />}
            >
              <span className="font-bold">{t.dashboard.trendTitle}</span>
            </CardTitle>
          }
          className="xl:col-span-2"
          actions={
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="w-3 h-0.5 bg-blue-500 rounded inline-block" />
                {t.dashboard.negotiations}
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-0.5 bg-emerald-500 rounded inline-block" />
                {t.dashboard.transfers}
              </span>
            </div>
          }
        >
          <ResponsiveContainer width="100%" height={180}>
            <LineChart
              data={trendData}
              margin={{ top: 4, right: 8, left: -20, bottom: 0 }}
            >
              <XAxis
                dataKey="t"
                tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                axisLine={false}
                tickLine={false}
                interval={2}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  fontSize: 11,
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  background: "var(--card)",
                  color: "var(--foreground)",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.18)",
                }}
                labelStyle={{ color: "var(--foreground)", fontWeight: 600 }}
                itemStyle={{ color: "var(--foreground)" }}
              />
              <Line
                type="monotone"
                dataKey="negs"
                name={t.dashboard.negotiations}
                stroke="#3B82F6"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="transfers"
                name={t.dashboard.transfers}
                stroke="#10B981"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        {/* FSM Donut */}
        <Card
          title={
            <CardTitle
              icon={<Activity className="w-3.5 h-3.5 text-blue-500" />}
            >
              <span className="font-bold">{t.dashboard.fsmDistribution}</span>
            </CardTitle>
          }
        >
          <div className="flex flex-col items-center">
            <ResponsiveContainer width="100%" height={130}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={38}
                  outerRadius={58}
                  dataKey="value"
                  strokeWidth={0}
                >
                  {pieData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    fontSize: 11,
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    background: "var(--card)",
                    color: "var(--foreground)",
                  }}
                  itemStyle={{ color: "var(--foreground)" }}
                />
              </PieChart>
            </ResponsiveContainer>
            {pieData.length === 0 ? (
              <div className="text-[11px] text-muted-foreground py-2">
                {t.dashboard.noResults}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 mt-1 w-full">
                {pieData.map(d => (
                  <div
                    key={d.name}
                    className="flex items-center gap-1.5 text-[11px]"
                  >
                    <span
                      className="w-2 h-2 rounded-sm flex-shrink-0"
                      style={{ background: d.color }}
                    />
                    <span className="text-muted-foreground truncate">
                      {d.name}
                    </span>
                    <span className="font-semibold text-foreground ml-auto">
                      {d.value}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Recent Negotiations */}
      <Card
        title={
          <CardTitle icon={<FileText className="w-3.5 h-3.5 text-blue-500" />}>
            <span className="font-bold">{t.dashboard.recentNegotiations}</span>
          </CardTitle>
        }
        actions={
          <ViewAllLink
            onClick={() => onNav(`/connectors/${conn.id}/negotiation`)}
          >
            {t.dashboard.viewAll}
          </ViewAllLink>
        }
      >
        {negError ? (
          <ListError onRetry={() => negRefetch()} fetching={negFetching} />
        ) : negotiations.length === 0 ? (
          <ListEmpty icon={<FileText />} message={t.dashboard.noResults} />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  {[
                    t.dashboard.col.negId,
                    t.dashboard.col.state,
                    t.dashboard.col.peer,
                    t.dashboard.col.time,
                  ].map(h => (
                    <th
                      key={h}
                      className="text-left text-[12px] font-bold text-foreground px-4 py-3 whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {negotiations.slice(0, 4).map(n => (
                  <tr
                    key={n?.id ?? Math.random()}
                    className="hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <span className="text-xs font-bold text-primary truncate">
                        {(n?.id ?? "").slice(0, 12)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <StateBadge name={n?.name ?? ""} />
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-foreground truncate block">
                        {n?.peer ?? ""}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="text-xs text-foreground"
                        title={n?.ts ?? ""}
                      >
                        {n?.ts ?? ""}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Recent Transfers */}
      <Card
        title={
          <CardTitle
            icon={<ArrowRightLeft className="w-3.5 h-3.5 text-blue-500" />}
          >
            <span className="font-bold">{t.dashboard.recentTransfers}</span>
          </CardTitle>
        }
        actions={
          <ViewAllLink onClick={() => onNav(`/connectors/${conn.id}/transfer`)}>
            {t.dashboard.viewAll}
          </ViewAllLink>
        }
      >
        {transfersError ? (
          <ListError
            onRetry={() => transfersRefetch()}
            fetching={transfersFetching}
          />
        ) : transfers.length === 0 ? (
          <ListEmpty
            icon={<ArrowRightLeft />}
            message={t.dashboard.noResults}
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  {[
                    t.dashboard.col.transferId,
                    t.dashboard.col.state,
                    t.dashboard.col.assetId,
                    t.dashboard.col.size,
                    t.dashboard.col.duration,
                    t.dashboard.col.time,
                  ].map(h => (
                    <th
                      key={h}
                      className="text-left text-[12px] font-bold text-foreground px-4 py-3 whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {transfers.slice(0, 4).map(tr => (
                  <tr
                    key={tr?.id ?? Math.random()}
                    className="hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <span className="text-xs font-bold text-primary truncate">
                        {(tr?.id ?? "").slice(0, 12)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <StateBadge name={tr?.name ?? ""} />
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-foreground truncate block">
                        {tr?.asset ?? ""}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-foreground">
                        {tr?.size ?? ""}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-foreground">
                        {tr?.t ?? ""}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="text-xs text-foreground"
                        title={tr?.ts ?? ""}
                      >
                        {tr?.ts ?? ""}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
