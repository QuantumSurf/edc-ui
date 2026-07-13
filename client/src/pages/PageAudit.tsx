// 감사 로그 (Audit Log) — Self-contained read-only audit trail viewer
// Filter by category / result / severity / time range, search by actor/target/action
// Click row → JSON detail | Export filtered set as CSV

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { fetchAuditEvents } from "@/services";
import {
  SectionHdr,
  Badge,
  MonoText,
  ListCard,
  ListHeaderRow,
  ListRow,
  ListEmpty,
  ListError,
  SortHeader,
  useTableSort,
  sortRows,
} from "@/components/ui-kmx";

// 컬럼은 lg/xl 에서만 보이므로(target=lg, severity·ip=xl) 트랙 수도 브레이크포인트별로
// 맞춘다. 안 맞추면 display:none 항목이 빠진 뒤 남은 셀이 앞 트랙부터 자동배치되어
// 엉뚱한 너비 트랙을 쓰고 뒤 트랙이 비어 줄이 어긋난다.
// md(5): 시각·행위자·액션·카테고리·결과 / lg(6): +대상 / xl(8): +심각도·IP
const AUDIT_COLS =
  "grid-cols-[170px_1fr_1.7fr_0.9fr_0.9fr] " +
  "lg:grid-cols-[170px_1fr_1.7fr_0.9fr_1.5fr_0.9fr] " +
  "xl:grid-cols-[170px_1fr_1.7fr_0.9fr_1.5fr_0.9fr_0.9fr_1fr]";
import { DetailPanel } from "@/components/DetailDeleteDialogs";
import {
  DataTablePagination,
  usePagination,
} from "@/components/DataTablePagination";
import {
  Activity,
  Download,
  Search,
  ScrollText,
  Calendar,
  Filter,
  X,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

/* ─── Types ──────────────────────────────────────────────────── */
type AuditCategory =
  | "AUTH"
  | "ASSET"
  | "POLICY"
  | "OFFERING"
  | "NEGOTIATION"
  | "TRANSFER"
  | "VAULT"
  | "CONNECTOR"
  | "SYSTEM";
type AuditResult = "SUCCESS" | "FAILURE";
type AuditSeverity = "INFO" | "WARN" | "CRITICAL";

interface AuditEvent {
  id: string;
  timestamp: string; // ISO
  actor: string; // user id
  actorRole: "admin" | "operator" | "viewer" | "system";
  action: string; // e.g. "asset.create"
  category: AuditCategory;
  target: string; // resource id
  targetType: string; // e.g. "Asset"
  result: AuditResult;
  severity: AuditSeverity;
  ip: string;
  userAgent: string;
  requestId: string;
  message: string;
  payload?: Record<string, unknown>;
}

/* ─── (제거됨) 데모 데이터 팩토리 — 실제 audit_logs 조회(fetchAuditEvents)로 대체 ─── */

/* ─── Helpers ────────────────────────────────────────────────── */
// 감사로그 시각은 ISO 8601(UTC) 표기: "2026-01-02T09:00:00.000Z" (다른 시각 표기와 달리).
function formatTs(iso: string) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toISOString();
}

const CAT_VARIANT: Record<
  AuditCategory,
  "blue" | "teal" | "purple" | "amber" | "sky" | "green" | "gray"
> = {
  AUTH: "purple",
  ASSET: "blue",
  POLICY: "teal",
  OFFERING: "sky",
  NEGOTIATION: "amber",
  TRANSFER: "green",
  VAULT: "purple",
  CONNECTOR: "blue",
  SYSTEM: "gray",
};

function severityBadge(sev: AuditSeverity, t: ReturnType<typeof useI18n>["t"]) {
  if (sev === "CRITICAL")
    return (
      <Badge variant="red">
        <AlertTriangle className="w-3 h-3" />
        {t.audit.severityCritical}
      </Badge>
    );
  if (sev === "WARN")
    return (
      <Badge variant="amber">
        <AlertTriangle className="w-3 h-3" />
        {t.audit.severityWarn}
      </Badge>
    );
  return <Badge variant="gray">{t.audit.severityInfo}</Badge>;
}

function resultBadge(r: AuditResult, t: ReturnType<typeof useI18n>["t"]) {
  return r === "SUCCESS" ? (
    <Badge variant="green">
      <CheckCircle2 className="w-3 h-3" />
      {t.audit.resultSuccess}
    </Badge>
  ) : (
    <Badge variant="red">
      <XCircle className="w-3 h-3" />
      {t.audit.resultFailure}
    </Badge>
  );
}

/* ─── 기간 필터 (시작일~종료일, 뷰어 로컬 시간대의 하루 경계 기준) ─── */
function toDateInput(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function daysAgoInput(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toDateInput(d);
}
/** 프리셋 → 시작일/종료일(종료일=오늘). 기본 기간은 "7D"(최근 1주일). */
function presetRange(key: "1D" | "7D" | "30D"): { from: string; to: string } {
  const days = key === "1D" ? 1 : key === "7D" ? 7 : 30;
  return { from: daysAgoInput(days), to: toDateInput(new Date()) };
}
/** 현재 from/to 가 어느 프리셋과 일치하는지(버튼 하이라이트용). 없으면 null(=커스텀 범위). */
function activePresetKey(
  from: string,
  to: string
): "ALL" | "1D" | "7D" | "30D" | null {
  if (!from && !to) return "ALL";
  if (to !== toDateInput(new Date())) return null;
  if (from === daysAgoInput(1)) return "1D";
  if (from === daysAgoInput(7)) return "7D";
  if (from === daysAgoInput(30)) return "30D";
  return null;
}
/** 감사 이벤트(ISO UTC)가 [from 00:00 ~ to 23:59:59.999](로컬) 안에 드는지. 빈 값이면 그 경계 없음. */
function withinDateRange(iso: string, from: string, to: string): boolean {
  const t = new Date(iso).getTime();
  if (isNaN(t)) return true;
  if (from) {
    const fromMs = new Date(`${from}T00:00:00`).getTime();
    if (!isNaN(fromMs) && t < fromMs) return false;
  }
  if (to) {
    const toMs = new Date(`${to}T23:59:59.999`).getTime();
    if (!isNaN(toMs) && t > toMs) return false;
  }
  return true;
}

/* ─── CSV Export ─────────────────────────────────────────────── */
function exportCsv(rows: AuditEvent[]) {
  const header = [
    "id",
    "timestamp",
    "actor",
    "actorRole",
    "action",
    "category",
    "target",
    "targetType",
    "result",
    "severity",
    "ip",
    "requestId",
    "message",
  ];
  const escape = (v: unknown) => {
    let s = String(v ?? "");
    // CSV 수식 인젝션 방어(CWE-1236): 위험 선두문자는 앞에 ' 를 붙여 텍스트로 강제.
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    header.join(","),
    ...rows.map(r =>
      header
        .map(h => escape((r as unknown as Record<string, unknown>)[h]))
        .join(",")
    ),
  ];
  const blob = new Blob([lines.join("\n")], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ─── Page ───────────────────────────────────────────────────── */
const CATEGORIES: ("ALL" | AuditCategory)[] = [
  "ALL",
  "AUTH",
  "ASSET",
  "POLICY",
  "OFFERING",
  "NEGOTIATION",
  "TRANSFER",
  "VAULT",
  "CONNECTOR",
  "SYSTEM",
];

export default function PageAudit() {
  const { t, locale } = useI18n();

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<"ALL" | AuditCategory>("ALL");
  const [result, setResult] = useState<"ALL" | AuditResult>("ALL");
  const [severity, setSeverity] = useState<"ALL" | AuditSeverity>("ALL");
  // 기간: 시작일~종료일(YYYY-MM-DD, 빈 문자열=경계 없음). 기본 최근 1주일(7D).
  const [dateFrom, setDateFrom] = useState<string>(
    () => presetRange("7D").from
  );
  const [dateTo, setDateTo] = useState<string>(() => presetRange("7D").to);
  const [selected, setSelected] = useState<AuditEvent | null>(null);

  const {
    data: rawEvents,
    isError,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["audit"],
    queryFn: () => fetchAuditEvents(500),
  });
  const allEvents = useMemo(
    () => (rawEvents ?? []) as AuditEvent[],
    [rawEvents]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allEvents.filter(e => {
      if (category !== "ALL" && e.category !== category) return false;
      if (result !== "ALL" && e.result !== result) return false;
      if (severity !== "ALL" && e.severity !== severity) return false;
      if (!withinDateRange(e.timestamp, dateFrom, dateTo)) return false;
      if (q) {
        const haystack =
          `${e.actor} ${e.action} ${e.target} ${e.message}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [allEvents, search, category, result, severity, dateFrom, dateTo]);

  // 컬럼 헤더 클릭 정렬 (기본: 최신순)
  const { sortKey, sortDir, toggleSort } = useTableSort("timestamp", "desc");
  const sorted = useMemo(
    () =>
      sortRows(filtered, sortKey, sortDir, (e, k) => {
        switch (k) {
          case "timestamp":
            return new Date(e.timestamp).getTime();
          case "actor":
            return e.actor;
          case "action":
            return e.action;
          case "category":
            return e.category;
          case "target":
            return e.target;
          case "result":
            return e.result;
          case "severity":
            return e.severity === "CRITICAL"
              ? 2
              : e.severity === "WARN"
                ? 1
                : 0;
          case "ip":
            return e.ip;
          default:
            return undefined;
        }
      }),
    [filtered, sortKey, sortDir]
  );

  const {
    paginatedData,
    totalItems,
    currentPage,
    pageSize,
    setCurrentPage,
    setPageSize,
  } = usePagination(sorted, 10);

  // Reset page when filters/sort change so users always see page 1 of new results.
  useEffect(() => {
    setCurrentPage(1);
  }, [
    search,
    category,
    result,
    severity,
    dateFrom,
    dateTo,
    sortKey,
    sortDir,
    setCurrentPage,
  ]);

  const catLabel: Record<"ALL" | AuditCategory, string> = {
    ALL: t.audit.catAll,
    AUTH: t.audit.catAuth,
    ASSET: t.audit.catAsset,
    POLICY: t.audit.catPolicy,
    OFFERING: t.audit.catOffering,
    NEGOTIATION: t.audit.catNegotiation,
    TRANSFER: t.audit.catTransfer,
    VAULT: t.audit.catVault,
    CONNECTOR: t.audit.catConnector,
    SYSTEM: t.audit.catSystem,
  };

  // 기본 기간(최근 1주일)에서 벗어났거나 다른 필터가 걸렸을 때만 '초기화' 노출.
  const rangeIsDefault = activePresetKey(dateFrom, dateTo) === "7D";
  const hasActiveFilter =
    !!search ||
    category !== "ALL" ||
    result !== "ALL" ||
    severity !== "ALL" ||
    !rangeIsDefault;

  return (
    <>
      <SectionHdr
        icon={<ScrollText className="w-5 h-5 text-primary" />}
        subtitle={t.pageSubtitles.audit}
      >
        {t.audit.title}
      </SectionHdr>

      {/* Filter + Search — 검색·필터·기간·내보내기를 한 카드에 인라인 (pcf 패턴) */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-card border border-border rounded-xl px-4 py-3 shadow-sm">
        {/* 검색 */}
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t.audit.searchPlaceholder}
            aria-label={t.audit.searchPlaceholder}
            className="w-full pl-8 pr-8 py-1.5 text-[12px] border border-border rounded-md bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
              aria-label={t.common.clear ?? "Clear"}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* 필터: 카테고리 / 결과 / 심각도 */}
        <Filter className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
        <label className="flex items-center gap-1.5">
          <span className="text-[11px] font-medium text-muted-foreground">
            {t.audit.filterCategory}
          </span>
          <select
            value={category}
            onChange={e => setCategory(e.target.value as "ALL" | AuditCategory)}
            className="text-[12px] border border-border rounded-md bg-background text-foreground px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {CATEGORIES.map(c => (
              <option key={c} value={c}>
                {catLabel[c]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          <span className="text-[11px] font-medium text-muted-foreground">
            {t.audit.filterResult}
          </span>
          <select
            value={result}
            onChange={e => setResult(e.target.value as "ALL" | AuditResult)}
            className="text-[12px] border border-border rounded-md bg-background text-foreground px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="ALL">{t.common.all}</option>
            <option value="SUCCESS">{t.audit.resultSuccess}</option>
            <option value="FAILURE">{t.audit.resultFailure}</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          <span className="text-[11px] font-medium text-muted-foreground">
            {t.audit.filterSeverity}
          </span>
          <select
            value={severity}
            onChange={e => setSeverity(e.target.value as "ALL" | AuditSeverity)}
            className="text-[12px] border border-border rounded-md bg-background text-foreground px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="ALL">{t.common.all}</option>
            <option value="INFO">{t.audit.severityInfo}</option>
            <option value="WARN">{t.audit.severityWarn}</option>
            <option value="CRITICAL">{t.audit.severityCritical}</option>
          </select>
        </label>

        {/* 우측: 초기화 + 내보내기 */}
        <div className="flex items-center gap-2 ml-auto">
          {hasActiveFilter && (
            <button
              onClick={() => {
                setSearch("");
                setCategory("ALL");
                setResult("ALL");
                setSeverity("ALL");
                setDateFrom(presetRange("7D").from);
                setDateTo(presetRange("7D").to);
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-rose-500/10 transition-colors"
            >
              <X className="w-3 h-3" />
              {t.audit.clearFilters}
            </button>
          )}
          {/* 모바일 전용 새로고침 — 데스크톱은 이벤트 목록 제목 옆에 있음(중복 방지 md:hidden) */}
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            aria-label={t.common.refresh}
            title={t.common.refresh}
            className="md:hidden inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12px] font-medium border border-border text-foreground hover:bg-muted disabled:opacity-50 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`}
            />
            {t.common.refresh}
          </button>
          <button
            onClick={() => {
              // 화면 표시 순서(정렬+필터)와 CSV 행 순서를 일치시킨다.
              exportCsv(sorted);
              toast.success(t.audit.exported);
            }}
            disabled={sorted.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-primary focus-visible:ring-offset-1"
          >
            <Download className="w-3.5 h-3.5" /> {t.audit.exportCsv}
          </button>
        </div>

        {/* 기간: 시작일~종료일 + 비우기 + 프리셋 — basis-full 로 검색창 아래 별도 행(기본 최근 1주일) */}
        <div className="basis-full w-full flex flex-wrap items-center gap-x-2 gap-y-2 pt-2.5 mt-0.5 border-t border-border/60">
          <Calendar className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
          <input
            type="date"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={e => setDateFrom(e.target.value)}
            aria-label={t.audit.dateFrom}
            className="text-[12px] border border-border rounded-md bg-background text-foreground px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary [color-scheme:light] dark:[color-scheme:dark]"
          />
          <span className="text-[12px] text-muted-foreground">~</span>
          <input
            type="date"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={e => setDateTo(e.target.value)}
            aria-label={t.audit.dateTo}
            className="text-[12px] border border-border rounded-md bg-background text-foreground px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary [color-scheme:light] dark:[color-scheme:dark]"
          />
          <button
            onClick={() => {
              setDateFrom("");
              setDateTo("");
            }}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
          >
            {t.common.clear}
          </button>
          <div className="flex items-center gap-1.5 sm:ml-1">
            {(["ALL", "1D", "7D", "30D"] as const).map(r => (
              <RangeBtn
                key={r}
                active={activePresetKey(dateFrom, dateTo) === r}
                onClick={() => {
                  if (r === "ALL") {
                    setDateFrom("");
                    setDateTo("");
                  } else {
                    const pr = presetRange(r);
                    setDateFrom(pr.from);
                    setDateTo(pr.to);
                  }
                }}
              >
                {r === "ALL" ? t.audit.rangeAll : r}
              </RangeBtn>
            ))}
          </div>
        </div>
      </div>

      {/* 스크린리더용 결과 개수 통지 (필터 변경 시 갱신) */}
      <p
        aria-live="polite"
        className="sr-only"
      >{`${filtered.length}${locale === "ko" ? "건" : " results"}`}</p>

      {/* List — Desktop */}
      <ListCard
        title={t.audit.listTitle}
        className="hidden md:block"
        responsive
        actions={
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            aria-label={t.common.refresh}
            title={t.common.refresh}
            className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-border hover:bg-muted disabled:opacity-50 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
          >
            <RefreshCw
              className={`w-3 h-3 ${isFetching ? "animate-spin" : ""}`}
            />
            {t.common.refresh}
          </button>
        }
      >
        {isError ? (
          <ListError onRetry={() => refetch()} fetching={isFetching} />
        ) : filtered.length === 0 ? (
          <ListEmpty
            icon={<Activity />}
            message={
              <>
                <span className="block text-[15px] font-semibold text-foreground mb-1">
                  {t.audit.emptyTitle}
                </span>
                {t.audit.emptyDesc}
              </>
            }
          />
        ) : (
          <>
            <ListHeaderRow cols={AUDIT_COLS}>
              <SortHeader
                label={t.audit.col.timestamp}
                columnKey="timestamp"
                activeKey={sortKey}
                dir={sortDir}
                onSort={toggleSort}
              />
              <SortHeader
                label={t.audit.col.actor}
                columnKey="actor"
                activeKey={sortKey}
                dir={sortDir}
                onSort={toggleSort}
              />
              <SortHeader
                label={t.audit.col.action}
                columnKey="action"
                activeKey={sortKey}
                dir={sortDir}
                onSort={toggleSort}
              />
              <SortHeader
                label={t.audit.col.category}
                columnKey="category"
                activeKey={sortKey}
                dir={sortDir}
                onSort={toggleSort}
              />
              <SortHeader
                label={t.audit.col.target}
                columnKey="target"
                activeKey={sortKey}
                dir={sortDir}
                onSort={toggleSort}
                className="hidden lg:inline-flex"
              />
              <SortHeader
                label={t.audit.col.result}
                columnKey="result"
                activeKey={sortKey}
                dir={sortDir}
                onSort={toggleSort}
              />
              <SortHeader
                label={t.audit.col.severity}
                columnKey="severity"
                activeKey={sortKey}
                dir={sortDir}
                onSort={toggleSort}
                className="hidden xl:inline-flex"
              />
              <SortHeader
                label={t.audit.col.ip}
                columnKey="ip"
                activeKey={sortKey}
                dir={sortDir}
                onSort={toggleSort}
                className="hidden xl:inline-flex"
              />
            </ListHeaderRow>
            {paginatedData.map(e => (
              <ListRow
                key={e.id}
                cols={AUDIT_COLS}
                selected={selected?.id === e.id}
                onClick={() => setSelected(e)}
                className={
                  e.result === "FAILURE" || e.severity === "CRITICAL"
                    ? "border-l-rose-400 bg-rose-50/30 dark:bg-rose-500/10"
                    : undefined
                }
              >
                <div>
                  <span
                    className="text-xs text-foreground"
                    title={new Date(e.timestamp).toLocaleString(undefined, {
                      year: "numeric",
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                      hour12: false,
                    })}
                  >
                    {formatTs(e.timestamp)}
                  </span>
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-foreground truncate">{e.actor}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {e.actorRole}
                  </p>
                </div>
                <div className="min-w-0">
                  <span className="text-xs font-bold text-primary block truncate">
                    {e.action}
                  </span>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {e.message}
                  </p>
                </div>
                <div>
                  <Badge variant={CAT_VARIANT[e.category]}>
                    {catLabel[e.category]}
                  </Badge>
                </div>
                <div className="hidden lg:block min-w-0">
                  <span className="text-xs text-foreground block truncate">
                    {e.target}
                  </span>
                  <p className="text-[11px] font-normal text-muted-foreground">
                    {e.targetType}
                  </p>
                </div>
                <div>{resultBadge(e.result, t)}</div>
                <div className="hidden xl:block">
                  {severityBadge(e.severity, t)}
                </div>
                <div className="hidden xl:block">
                  <span className="text-xs text-foreground">{e.ip}</span>
                </div>
              </ListRow>
            ))}
          </>
        )}

        {/* Pagination (desktop) */}
        {totalItems > 0 && (
          <DataTablePagination
            totalItems={totalItems}
            pageSize={pageSize}
            currentPage={currentPage}
            onPageChange={setCurrentPage}
            onPageSizeChange={setPageSize}
            rowsPerPageLabel={t.common.rowsPerPage}
          />
        )}
      </ListCard>

      {/* List — Mobile */}
      <div className="md:hidden flex flex-col gap-2">
        {isError ? (
          <ListError onRetry={() => refetch()} fetching={isFetching} />
        ) : filtered.length === 0 ? (
          <ListEmpty
            icon={<Activity />}
            message={
              <>
                <span className="block text-[15px] font-semibold text-foreground mb-1">
                  {t.audit.emptyTitle}
                </span>
                {t.audit.emptyDesc}
              </>
            }
          />
        ) : (
          paginatedData.map(e => (
            <div
              key={e.id}
              onClick={() => setSelected(e)}
              role="button"
              tabIndex={0}
              onKeyDown={ev => {
                if (ev.key === "Enter" || ev.key === " ") {
                  ev.preventDefault();
                  setSelected(e);
                }
              }}
              className={`bg-card rounded-xl p-3 shadow-sm border border-border border-l-2 active:bg-muted/40 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary ${
                e.result === "FAILURE" || e.severity === "CRITICAL"
                  ? "border-l-rose-400 bg-rose-50/30 dark:bg-rose-500/10"
                  : "border-l-transparent"
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <Badge variant={CAT_VARIANT[e.category]}>
                  {catLabel[e.category]}
                </Badge>
                <div className="flex items-center gap-1">
                  {resultBadge(e.result, t)}
                  {severityBadge(e.severity, t)}
                </div>
              </div>
              <span className="text-xs font-bold text-primary block">
                {e.action}
              </span>
              <p className="text-[12px] text-muted-foreground mt-0.5 truncate">
                {e.message}
              </p>
              <div className="flex items-center justify-between mt-2 text-[11px] text-muted-foreground">
                <span
                  title={new Date(e.timestamp).toLocaleString(undefined, {
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                    hour12: false,
                  })}
                >
                  <MonoText className="text-[11px] font-normal">
                    {formatTs(e.timestamp)}
                  </MonoText>
                </span>
                <span className="font-normal">{e.actor}</span>
              </div>
            </div>
          ))
        )}

        {/* Pagination (mobile) */}
        {totalItems > 0 && (
          <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
            <DataTablePagination
              totalItems={totalItems}
              pageSize={pageSize}
              currentPage={currentPage}
              onPageChange={setCurrentPage}
              onPageSizeChange={setPageSize}
              rowsPerPageLabel={t.common.rowsPerPage}
            />
          </div>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground/70">
        {t.audit.retentionNotice}
      </p>

      {/* Detail Panel */}
      {selected && (
        <DetailPanel
          open={!!selected}
          onClose={() => setSelected(null)}
          title={t.audit.detailTitle}
          icon={<ScrollText className="w-4 h-4 text-primary" />}
          sections={[
            {
              title: t.audit.field.timestamp,
              fields: [
                {
                  label: t.audit.field.eventId,
                  value: selected.id,
                  mono: true,
                  copyable: true,
                },
                {
                  label: t.audit.field.timestamp,
                  value: formatTs(selected.timestamp),
                  mono: true,
                },
                {
                  label: t.audit.field.requestId,
                  value: selected.requestId,
                  mono: true,
                  copyable: true,
                },
                {
                  label: t.audit.field.category,
                  value: catLabel[selected.category],
                  badge: {
                    text: catLabel[selected.category],
                    variant:
                      CAT_VARIANT[selected.category] === "sky"
                        ? "blue"
                        : (CAT_VARIANT[selected.category] as
                            | "blue"
                            | "green"
                            | "amber"
                            | "gray"
                            | "red"
                            | "purple"),
                  },
                },
              ],
            },
            {
              title: t.audit.field.actor,
              fields: [
                {
                  label: t.audit.field.actor,
                  value: selected.actor,
                  mono: true,
                },
                { label: t.audit.field.actorRole, value: selected.actorRole },
                {
                  label: t.audit.field.ip,
                  value: selected.ip,
                  mono: true,
                  copyable: true,
                },
                {
                  label: t.audit.field.userAgent,
                  value: selected.userAgent,
                  mono: true,
                },
              ],
            },
            {
              title: t.audit.field.action,
              fields: [
                {
                  label: t.audit.field.action,
                  value: selected.action,
                  mono: true,
                  copyable: true,
                },
                {
                  label: t.audit.field.target,
                  value: selected.target,
                  mono: true,
                  copyable: true,
                },
                { label: t.audit.field.targetType, value: selected.targetType },
                {
                  label: t.audit.field.result,
                  value:
                    selected.result === "SUCCESS"
                      ? t.audit.resultSuccess
                      : t.audit.resultFailure,
                  badge: {
                    text:
                      selected.result === "SUCCESS"
                        ? t.audit.resultSuccess
                        : t.audit.resultFailure,
                    variant: selected.result === "SUCCESS" ? "green" : "red",
                  },
                },
                {
                  label: t.audit.field.severity,
                  value:
                    selected.severity === "CRITICAL"
                      ? t.audit.severityCritical
                      : selected.severity === "WARN"
                        ? t.audit.severityWarn
                        : t.audit.severityInfo,
                  badge: {
                    text:
                      selected.severity === "CRITICAL"
                        ? t.audit.severityCritical
                        : selected.severity === "WARN"
                          ? t.audit.severityWarn
                          : t.audit.severityInfo,
                    variant:
                      selected.severity === "CRITICAL"
                        ? "red"
                        : selected.severity === "WARN"
                          ? "amber"
                          : "gray",
                  },
                },
                { label: t.audit.field.message, value: selected.message },
                ...(selected.payload
                  ? [
                      {
                        label: t.audit.field.payload,
                        value: "",
                        json: selected.payload,
                      } as const,
                    ]
                  : []),
              ],
            },
          ]}
        />
      )}
    </>
  );
}

/* ─── Filter primitives ──────────────────────────────────────── */
function RangeBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary ${
        active
          ? "bg-primary/10 text-primary border-primary/30"
          : "bg-card border-border text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
