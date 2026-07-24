// Connector Hub — Single Connector Dashboard
// Design: Admin Console style | Large KPI numbers + white cards + line charts

import { type Connector } from "@/lib/data";
import { useI18n } from "@/i18n";
import { fmtNum } from "@/lib/format";
import { useQuery } from "@tanstack/react-query";
import {
  fetchAssets,
  fetchNegotiations,
  fetchTransfers,
  fetchTrend,
  fetchTransferCounts,
  fetchStatsSummary,
} from "@/services";
import {
  Card,
  StateBadge,
  SectionHdr,
  KpiCard,
  CardTitle,
  ViewAllLink,
  ListError,
  ListEmpty,
  RefreshButton,
} from "@/components/ui-kmx";
import {
  Package,
  ArrowRightLeft,
  Activity,
  TrendingUp,
  LayoutDashboard,
  FileText,
  CheckCircle2,
  Handshake,
  Download,
} from "lucide-react";
import { useMemo, useState } from "react";
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
  // ACCEPTED/AGREED: 틸(#14B8A6)은 계약 성립(FINALIZED #10B981 그린)과 구분이 안 돼 앰버로 변경.
  ACCEPTED: "#F59E0B",
  AGREED: "#F59E0B",
  VERIFIED: "#6366F1",
  TERMINATED: "#EF4444",
};

interface PageDashboardProps {
  conn: Connector;
  onNav: (page: string) => void;
}

export default function PageDashboard({ conn, onNav }: PageDashboardProps) {
  const { t } = useI18n();

  // Recharts 애니메이션은 JS 기반이라 CSS prefers-reduced-motion 규칙이 안 먹는다.
  // 접근성(WCAG 2.3.3)을 위해 직접 판정해 차트 애니메이션을 끈다.
  const prefersReducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const {
    data: negotiations = [],
    isError: negError,
    isLoading: negLoading,
    refetch: negRefetch,
    isFetching: negFetching,
  } = useQuery({
    queryKey: ["negotiations", conn.id],
    queryFn: () => fetchNegotiations(conn.id),
    refetchInterval: 10_000,
    // 포커스 안 된 창(예: 관리자/이용자 2창 중 뒤에 있는 것)도 계속 갱신되도록.
    refetchIntervalInBackground: true,
  });

  const {
    data: transfers = [],
    isError: transfersError,
    refetch: transfersRefetch,
    isFetching: transfersFetching,
  } = useQuery({
    queryKey: ["transfers", conn.id],
    queryFn: () => fetchTransfers(conn.id),
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
  });

  // 기간 선택(24h/3d/7d) — 트렌드(hours)와 성공률 KPI(days)가 함께 따라간다.
  const [periodHours, setPeriodHours] = useState<24 | 72 | 168>(24);
  const periodDays = periodHours / 24;

  const {
    data: trendData = [],
    refetch: trendRefetch,
    isFetching: trendFetching,
  } = useQuery({
    queryKey: ["stats-trend", conn.id, periodHours],
    queryFn: () => fetchTrend(conn.id, periodHours),
    refetchInterval: 30_000, // 트렌드 집계는 무거워 30초마다
  });

  // 성공률 KPI — 관측된 터미널(metadata.last_state) 기준. 실패해도 카드만 "—".
  const { data: summary } = useQuery({
    queryKey: ["stats-summary", conn.id, periodDays],
    queryFn: () => fetchStatsSummary(conn.id, periodDays),
    refetchInterval: 30_000,
  });

  // 트렌드 CSV 다운로드 — BOM(엑셀 한글 인코딩) + 수식 인젝션 방어(=,+,-,@ 접두 무력화).
  const downloadTrendCsv = () => {
    const esc = (v: unknown): string => {
      let cell = String(v ?? "");
      if (/^[=+\-@]/.test(cell)) cell = `'${cell}`; // 스프레드시트 수식 실행 차단
      return /[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
    };
    const rows = [
      ["time", "negotiations", "transfers"],
      ...trendData.map(r => [r.t, r.negs, r.transfers]),
    ];
    const csv = "\uFEFF" + rows.map(row => row.map(esc).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trend-${conn.id}-${periodHours}h.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 전송 '정확 총계'(목록 상한 EDC_QUERY_LIMIT 우회). EDC DB 접속이 설정된 커넥터만
  // exact:true. 미설정이면 아래에서 목록 길이로 폴백.
  const { data: transferCounts } = useQuery({
    queryKey: ["transfer-counts", conn.id],
    queryFn: () => fetchTransferCounts(conn.id),
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
  });

  // 자산 KPI 는 사이드바와 동일한 ["assets", conn.id] 캐시를 공유해, 자산 추가/삭제 시
  // 두 표시가 항상 일치하도록 한다(정적 conn.assets 사용 시 한 화면에서 수가 어긋남).
  const {
    data: assetList,
    refetch: assetsRefetch,
    isFetching: assetsFetching,
  } = useQuery({
    queryKey: ["assets", conn.id],
    queryFn: () => fetchAssets(conn.id),
    staleTime: 60_000,
  });
  const assetCount = assetList?.length ?? conn.assets;

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

  // 표시값: EDC DB 정확 카운트가 있으면 그걸(상한 우회), 없으면 목록 기반으로 폴백.
  const exactCounts = transferCounts?.exact === true;
  const transferTotal = exactCounts
    ? (transferCounts?.transfers ?? 0)
    : transfers.length;
  const transferDone = exactCounts
    ? (transferCounts?.transfersCompleted ?? 0)
    : transferStats.done;
  const transferActive = exactCounts
    ? (transferCounts?.transfersActive ?? 0)
    : transferStats.active;

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
      <SectionHdr
        icon={<LayoutDashboard className="w-5 h-5 text-primary" />}
        subtitle={t.pageSubtitles.dashboard}
        action={
          <RefreshButton
            // 페이지 수준 새로고침 — 트렌드만이 아닌 4개 소스(KPI·도넛·최근활동) 전부 갱신.
            // assets 는 사이드바와 캐시 공유라 배지 카운트도 함께 갱신된다.
            onRefresh={() => {
              negRefetch();
              transfersRefetch();
              trendRefetch();
              assetsRefetch();
            }}
            busy={
              negFetching ||
              transfersFetching ||
              trendFetching ||
              assetsFetching
            }
            label={t.common.refresh}
          />
        }
      >
        {t.nav.dashboard}
      </SectionHdr>

      {/* KPI Row — KpiCard 통일 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <KpiCard
          icon={
            <Package className="w-[18px] h-[18px] text-blue-600 dark:text-blue-400" />
          }
          iconBg="bg-blue-50 dark:bg-blue-500/10"
          value={fmtNum(assetCount)}
          title={t.dashboard.assets}
          sub={t.dashboard.includingOfferings}
          trend="up"
          onClick={() => onNav(`/connectors/${conn.id}/assets`)}
          ariaLabel={`${t.dashboard.assets} ${assetCount}`}
        />
        <KpiCard
          icon={
            <ArrowRightLeft className="w-[18px] h-[18px] text-sky-600 dark:text-sky-400" />
          }
          iconBg="bg-sky-50 dark:bg-sky-500/10"
          value={transfersError ? "—" : fmtNum(transferTotal)}
          title={t.dashboard.dataTransfers}
          sub={t.dashboard.completedInProgress(transferDone, transferActive)}
          valueColor="text-sky-600 dark:text-sky-400"
          trend="up"
          onClick={() => onNav(`/connectors/${conn.id}/transfer`)}
          ariaLabel={`${t.dashboard.dataTransfers} ${transfersError ? "—" : transferTotal}`}
        />
        {/* 성공률 KPI — 관측된 터미널(콘솔이 열람한 협상/전송) 기준 운영 지표 */}
        <KpiCard
          icon={
            <Handshake className="w-[18px] h-[18px] text-emerald-600 dark:text-emerald-400" />
          }
          iconBg="bg-emerald-50 dark:bg-emerald-500/10"
          value={
            summary?.negotiations.successRate != null
              ? `${summary.negotiations.successRate}%`
              : "—"
          }
          title={t.dashboard.negSuccessRate}
          sub={
            summary && summary.negotiations.total > 0
              ? t.dashboard.successRateSub(
                  summary.negotiations.finalized,
                  summary.negotiations.total
                )
              : t.dashboard.successRateNoData
          }
          valueColor="text-emerald-600 dark:text-emerald-400"
          onClick={() => onNav(`/connectors/${conn.id}/negotiation`)}
          ariaLabel={`${t.dashboard.negSuccessRate} ${summary?.negotiations.successRate ?? "—"}`}
        />
        <KpiCard
          icon={
            <CheckCircle2 className="w-[18px] h-[18px] text-violet-600 dark:text-violet-400" />
          }
          iconBg="bg-violet-50 dark:bg-violet-500/10"
          value={
            summary?.transfers.successRate != null
              ? `${summary.transfers.successRate}%`
              : "—"
          }
          title={t.dashboard.trSuccessRate}
          sub={
            summary && summary.transfers.total > 0
              ? t.dashboard.successRateSub(
                  summary.transfers.completed,
                  summary.transfers.total
                )
              : t.dashboard.successRateNoData
          }
          valueColor="text-violet-600 dark:text-violet-400"
          onClick={() => onNav(`/connectors/${conn.id}/transfer`)}
          ariaLabel={`${t.dashboard.trSuccessRate} ${summary?.transfers.successRate ?? "—"}`}
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
              {/* 기간 선택 — 트렌드(hours)와 성공률 KPI(days)가 함께 바뀐다 */}
              <div
                className="flex items-center rounded-md border border-border overflow-hidden"
                role="group"
                aria-label={t.dashboard.trendTitle}
              >
                {(
                  [
                    [24, t.dashboard.period24h],
                    [72, t.dashboard.period3d],
                    [168, t.dashboard.period7d],
                  ] as const
                ).map(([h, label]) => (
                  <button
                    key={h}
                    onClick={() => setPeriodHours(h)}
                    aria-pressed={periodHours === h}
                    className={`px-2 py-0.5 text-[11px] ${
                      periodHours === h
                        ? "bg-primary text-primary-foreground"
                        : "hover:bg-muted"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <button
                onClick={downloadTrendCsv}
                aria-label={t.dashboard.exportCsv}
                title={t.dashboard.exportCsv}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-border hover:bg-muted"
              >
                <Download className="w-3 h-3" />
                CSV
              </button>
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
                // 24h=시간별 24점 → 2칸 간격, 3d/7d=72·168점 → 라벨 과밀 방지 간격 확대
                interval={periodHours === 24 ? 2 : Math.floor(periodHours / 8)}
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
                isAnimationActive={!prefersReducedMotion}
              />
              <Line
                type="monotone"
                dataKey="transfers"
                name={t.dashboard.transfers}
                stroke="#10B981"
                strokeWidth={2}
                dot={false}
                isAnimationActive={!prefersReducedMotion}
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
                  isAnimationActive={!prefersReducedMotion}
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
                  formatter={(value: number, name: string) => [
                    fmtNum(value),
                    (t.negotiations.states as Record<string, string>)[name] ??
                      name,
                  ]}
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
                      {(t.negotiations.states as Record<string, string>)[
                        d.name
                      ] ?? d.name}
                    </span>
                    <span className="font-semibold text-foreground ml-auto">
                      {fmtNum(d.value)}
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
        ) : negLoading ? (
          <div className="py-8 text-center text-[12px] text-muted-foreground">
            {t.common.loading}
          </div>
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
                {[...negotiations]
                  .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
                  .slice(0, 4)
                  .map(n => (
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
                {[...transfers]
                  .sort((a, b) => String(b.ts).localeCompare(String(a.ts)))
                  .slice(0, 4)
                  .map(tr => (
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
                        <StateBadge
                          name={tr?.name ?? ""}
                          label={
                            (t.transfers.states as Record<string, string>)[
                              tr?.name ?? ""
                            ] ??
                            tr?.name ??
                            ""
                          }
                        />
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
