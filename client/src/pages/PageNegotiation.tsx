// Connector Hub — Contract Negotiation Page (spec 4.5)
// FSM state polling, search & filter buttons, responsive table/card

import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { fetchNegotiations, terminateNegotiation } from "@/services";
import { type Negotiation, isNegotiationActive } from "@/lib/data";
import { useConnectorStore } from "@/stores/connectorStore";
import {
  DataTablePagination,
  usePagination,
} from "@/components/DataTablePagination";
import {
  Card,
  StateBadge,
  SectionHdr,
  ListEmpty,
  ListError,
  inputBase,
  RefreshButton,
} from "@/components/ui-kmx";
import {
  ConfirmActionDialog,
  JsonViewerDialog,
  InfoCard,
} from "@/components/DetailDeleteDialogs";
import {
  FileText,
  AlertCircle,
  Copy,
  XCircle,
  Search,
  Loader2,
  Clock,
  X,
  ChevronsRight,
  Code,
  Send,
  List,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import { RoleGate } from "@/components/RoleGate";
import { cn, clickable } from "@/lib/utils";
import { useDialogA11y } from "@/hooks/useDialogA11y";

type FilterKey = "ALL" | "FINALIZED" | "REQUESTING" | "AGREED" | "TERMINATED";
type TimeRange = "ALL" | "1D" | "7D" | "30D";
const TIME_RANGES: { value: TimeRange; days: number | null }[] = [
  { value: "ALL", days: null },
  { value: "1D", days: 1 },
  { value: "7D", days: 7 },
  { value: "30D", days: 30 },
];

interface PageNegotiationProps {
  onNav: (path: string) => void;
}

const TERMINAL_STATES = new Set(["FINALIZED", "TERMINATED"]);

export default function PageNegotiation({ onNav }: PageNegotiationProps) {
  const { t } = useI18n();
  const connector = useConnectorStore(s => s.connector);
  const connectorId = connector?.id;
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<FilterKey>("ALL");
  const [search, setSearch] = useState("");
  const [timeRange, setTimeRange] = useState<TimeRange>("ALL");

  // Terminate modal state
  const [terminateTarget, setTerminateTarget] = useState<Negotiation | null>(
    null
  );
  const [terminateReason, setTerminateReason] = useState("");

  // Detail / JSON dialog state
  const [detailTarget, setDetailTarget] = useState<Negotiation | null>(null);
  const [jsonTarget, setJsonTarget] = useState<Negotiation | null>(null);

  const terminateMutation = useMutation({
    mutationFn: (n: Negotiation) =>
      terminateNegotiation(n.id, connectorId!, terminateReason.trim()),
    onSuccess: () => {
      toast.success(t.negotiations.terminateSuccess);
      setTerminateTarget(null);
      setTerminateReason("");
      queryClient.invalidateQueries({
        queryKey: ["negotiations", connectorId],
      });
    },
    onError: () => {
      toast.error(t.negotiations.terminateFailed);
    },
  });

  const {
    data: negotiations = [],
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["negotiations", connectorId],
    queryFn: () => fetchNegotiations(connectorId!),
    enabled: !!connectorId,
    refetchInterval: query => {
      const data = query.state.data;
      // 진행중(비종단·알려진 상태)만 폴링. 미지 상태(state<=0)는 종단 취급해 무한 폴링 방지.
      if (data?.some(n => isNegotiationActive(n.state))) return 3000;
      return false;
    },
  });

  const rows = useMemo(() => {
    let filtered =
      filter === "ALL"
        ? negotiations
        : negotiations.filter(n => n.name === filter);

    // Search by id / peer / assetId / agreementId
    const q = search.trim().toLowerCase();
    if (q) {
      filtered = filtered.filter(
        n =>
          n.id.toLowerCase().includes(q) ||
          (n.peer ?? "").toLowerCase().includes(q) ||
          (n.assetId ?? "").toLowerCase().includes(q) ||
          (n.agreementId ?? "").toLowerCase().includes(q)
      );
    }

    // Time range filter — 표시용 ts(로컬라이즈 문자열)는 Date.parse 불가하므로
    // 머신리더블 createdAt(epoch ms)로 필터. createdAt 미확인이면 보수적으로 통과.
    const range = TIME_RANGES.find(r => r.value === timeRange);
    if (range?.days != null) {
      const cutoff = Date.now() - range.days * 86400_000;
      filtered = filtered.filter(n =>
        n.createdAt != null ? n.createdAt >= cutoff : true
      );
    }

    // 최신 생성시각(createdAt) 내림차순 정렬. 표시 문자열 정렬은 12시간제 경계에서
    // 역전되므로 epoch로 정렬하고, 동시각은 id로 결정적 tie-break.
    return [...filtered].sort((a, b) => {
      const av = a.createdAt ?? -Infinity;
      const bv = b.createdAt ?? -Infinity;
      if (bv !== av) return bv - av;
      return a.id.localeCompare(b.id);
    });
  }, [negotiations, filter, search, timeRange]);

  const {
    paginatedData,
    totalItems,
    currentPage,
    pageSize,
    setCurrentPage,
    setPageSize,
  } = usePagination(rows, 10);

  const filters: FilterKey[] = [
    "ALL",
    "FINALIZED",
    "REQUESTING",
    "AGREED",
    "TERMINATED",
  ];

  function filterLabel(f: FilterKey): string {
    if (f === "ALL") return t.common.all;
    return t.negotiations.states[f] ?? f;
  }

  const handleTransferStart = (n: Negotiation) => {
    const params = new URLSearchParams();
    if (n.agreementId) params.set("agreementId", n.agreementId);
    if (n.assetId) params.set("assetId", n.assetId);
    if (n.counterPartyAddress) params.set("cpa", n.counterPartyAddress);
    onNav(`/connectors/${connectorId}/transfer?${params.toString()}`);
  };

  const handleTerminatedDetail = (n: Negotiation) => {
    toast.error(n.errorDetail || t.negotiations.terminatedToast(n.peer, n.t), {
      duration: 5000,
    });
  };

  return (
    <>
      {/* ── Terminate Confirm Modal ─────────────────────────────── */}
      <ConfirmActionDialog
        open={!!terminateTarget}
        onClose={() => {
          setTerminateTarget(null);
          setTerminateReason("");
        }}
        title={t.negotiations.terminate}
        description={t.negotiations.terminateConfirm}
        subtitle={terminateTarget?.id}
        tone="danger"
        confirmLabel={t.negotiations.terminate}
        loading={terminateMutation.isPending}
        input={{
          placeholder: t.negotiations.terminateReasonPlaceholderRequired,
          helper: (
            <>
              <span className="text-rose-500">*</span>{" "}
              {t.negotiations.reasonRequiredHint}
            </>
          ),
          value: terminateReason,
          onChange: setTerminateReason,
          autoFocus: true,
        }}
        onConfirm={() => {
          if (terminateTarget) terminateMutation.mutate(terminateTarget);
        }}
      />

      <SectionHdr
        icon={<FileText className="w-5 h-5 text-primary" />}
        subtitle={t.pageSubtitles.negotiations}
        action={
          <RefreshButton
            onRefresh={() => refetch()}
            busy={isFetching}
            label={t.common.refresh}
          />
        }
      >
        {t.negotiations.title}
      </SectionHdr>
      {/* ── Search & Filter — fl-aggregator TasksPage style ───── */}
      <div className="flex flex-col sm:flex-row gap-3 flex-wrap items-stretch sm:items-center bg-card border border-border rounded-xl px-4 py-3 shadow-sm">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder={t.negotiations.searchPlaceholder}
            value={search}
            onChange={e => {
              setSearch(e.target.value);
              setCurrentPage(1);
            }}
            aria-label={t.negotiations.searchPlaceholder}
            className={`${inputBase} pl-8 !bg-background`}
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {filters.map(f => (
            <button
              key={f}
              onClick={() => {
                setFilter(f);
                setCurrentPage(1);
              }}
              aria-pressed={filter === f}
              className={`px-3 py-1.5 rounded-full text-[11px] font-medium transition-all duration-150 border focus:outline-none focus-visible:ring-1 focus-visible:ring-primary ${
                filter === f
                  ? "bg-primary text-primary-foreground border-primary shadow-sm"
                  : "bg-card border-border text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {filterLabel(f)}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5 flex-wrap items-center">
          <Clock className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
          {TIME_RANGES.map(r => (
            <button
              key={r.value}
              onClick={() => {
                setTimeRange(r.value);
                setCurrentPage(1);
              }}
              aria-pressed={timeRange === r.value}
              className={`px-3 py-1.5 rounded-full text-[11px] font-medium transition-all duration-150 border focus:outline-none focus-visible:ring-1 focus-visible:ring-primary ${
                timeRange === r.value
                  ? "bg-foreground text-background border-foreground shadow-sm"
                  : "bg-card border-border text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {r.value === "ALL" ? t.common.all : r.value}
            </button>
          ))}
        </div>
      </div>

      <div>
        {/* Negotiation List */}
        <div className="min-w-0">
          {/* Loading state */}
          {isLoading && (
            <Card>
              <div className="flex items-center justify-center py-10 gap-2 text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-[13px]">{t.common.loading}</span>
              </div>
            </Card>
          )}

          {/* Error state */}
          {!isLoading && isError && (
            <Card>
              <ListError onRetry={() => refetch()} fetching={isFetching} />
            </Card>
          )}

          {!isLoading && !isError && (
            <>
              {/* Desktop/Tablet: Table — asset-list style */}
              <div className="hidden md:block bg-card rounded-xl border border-border shadow-sm overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
                  <span className="font-display text-[14px] font-bold text-foreground flex items-center gap-2 truncate">
                    <List className="w-4 h-4 text-primary" />
                    {t.negotiations.listTitle}
                  </span>
                  <span className="text-[11px] font-normal text-muted-foreground flex-shrink-0">
                    {t.negotiations.resultCount(
                      totalItems,
                      negotiations.length
                    )}
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px]">
                    <thead>
                      <tr className="border-b border-border bg-muted/50">
                        <th className="px-4 py-3 text-left text-[12px] font-bold text-foreground">
                          {t.negotiations.col.id}
                        </th>
                        <th className="px-4 py-3 text-left text-[12px] font-bold text-foreground">
                          {t.negotiations.col.state}
                        </th>
                        <th className="px-4 py-3 text-left text-[12px] font-bold text-foreground">
                          {t.negotiations.col.peer}
                        </th>
                        <th className="px-4 py-3 text-left text-[12px] font-bold text-foreground">
                          {t.negotiations.col.duration}
                        </th>
                        <th className="px-4 py-3 text-left text-[12px] font-bold text-foreground">
                          {t.negotiations.col.time}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {paginatedData.map(n => (
                        <tr
                          key={n.id}
                          className={cn(
                            "table-row-hover group cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary [&>td:first-child]:border-l-2",
                            detailTarget?.id === n.id
                              ? "bg-primary/5 [&>td:first-child]:border-l-primary"
                              : "[&>td:first-child]:border-l-transparent"
                          )}
                          onClick={() => setDetailTarget(n)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={e => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setDetailTarget(n);
                            }
                          }}
                        >
                          <td className="px-4 py-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-1">
                                <span className="text-xs text-foreground truncate">
                                  {n.id}
                                </span>
                                <button
                                  onClick={e => {
                                    e.stopPropagation();
                                    navigator.clipboard.writeText(n.id);
                                    toast.success(t.common.copied);
                                  }}
                                  className="opacity-60 group-hover:opacity-100 transition-opacity flex-shrink-0 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded"
                                  aria-label={t.common.copy ?? "Copy"}
                                >
                                  <Copy className="w-3 h-3 text-muted-foreground hover:text-foreground" />
                                </button>
                              </div>
                              {n.assetId ? (
                                <span className="text-xs font-bold text-primary block truncate">
                                  {n.assetId}
                                </span>
                              ) : (
                                <div className="text-xs text-muted-foreground/50">
                                  —
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <StateBadge name={n.name} />
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-xs text-foreground block break-all">
                              {n.peer}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-xs text-foreground">
                              {n.t}
                            </span>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span
                              className="text-xs text-foreground"
                              title={n.ts}
                            >
                              {n.ts}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {rows.length === 0 && (
                    <ListEmpty
                      icon={<FileText />}
                      message={t.negotiations.noResults}
                    />
                  )}
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
                </div>
              </div>

              {/* Mobile: Card Stack */}
              <div className="md:hidden flex flex-col gap-3">
                {paginatedData.map(n => (
                  <NegotiationCard
                    key={n.id}
                    negotiation={n}
                    onSelect={setDetailTarget}
                  />
                ))}
                {rows.length === 0 && (
                  <ListEmpty
                    icon={<FileText />}
                    message={t.negotiations.noResults}
                  />
                )}
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
            </>
          )}
        </div>

        {/* Detail Sheet */}
        {detailTarget && (
          <NegotiationDetailSheet
            target={detailTarget}
            onClose={() => setDetailTarget(null)}
            onShowJson={() => {
              setJsonTarget(detailTarget);
              setDetailTarget(null);
            }}
            onTransfer={() => {
              handleTransferStart(detailTarget);
            }}
            onTerminate={() => {
              setDetailTarget(null);
              setTerminateTarget(detailTarget);
              setTerminateReason("");
            }}
            onError={() => {
              handleTerminatedDetail(detailTarget);
            }}
          />
        )}

        {/* JSON Viewer */}
        {jsonTarget && (
          <NegotiationJsonDialog
            negotiation={jsonTarget}
            onClose={() => setJsonTarget(null)}
          />
        )}
      </div>
    </>
  );
}

/* ─── Detail Sheet (asset-style card grid) ───────────────────── */
function NegotiationDetailSheet({
  target,
  onClose,
  onShowJson,
  onTransfer,
  onTerminate,
  onError,
}: {
  target: Negotiation;
  onClose: () => void;
  onShowJson: () => void;
  onTransfer: () => void;
  onTerminate: () => void;
  onError: () => void;
}) {
  const { t } = useI18n();
  const [entered, setEntered] = useState(false);
  const terminated = target.name === "TERMINATED";
  const isTerminal = TERMINAL_STATES.has(target.name);
  // 마운트 = 열림. 초기 포커스/트랩/스크롤락/복원 제공.
  const dialogRef = useDialogA11y(true);

  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [onClose]);

  return (
    <>
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/20 transition-opacity duration-200",
          entered ? "opacity-100" : "opacity-0"
        )}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="negotiation-detail-title"
        tabIndex={-1}
        className={cn(
          "fixed right-0 top-0 z-50 h-full w-full sm:max-w-2xl bg-card flex flex-col transition-transform duration-200 ease-out shadow-2xl",
          entered ? "translate-x-0" : "translate-x-full"
        )}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2 pr-8">
            <FileText className="w-4 h-4 text-primary flex-shrink-0" />
            <h2
              id="negotiation-detail-title"
              className="text-[15px] font-semibold text-foreground truncate"
            >
              {t.negotiations.title}
            </h2>
            <StateBadge name={target.name} />
          </div>
          {/* 닫기 — identityhub-ui Sheet 와 동일 우상단 절대 위치로 통일 */}
          <button
            onClick={onClose}
            aria-label={t.common.close}
            className="absolute top-4 right-4 z-10 rounded-xs opacity-70 transition-opacity hover:opacity-100 ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          >
            <X className="size-4" />
          </button>
          {/* UUID는 보조 식별자 줄로 강등 (복사 가능) */}
          <div className="flex items-center gap-1.5 mt-1">
            <span className="text-[11px] mono text-muted-foreground truncate">
              {target.id}
            </span>
            <button
              onClick={() => {
                navigator.clipboard.writeText(target.id);
                toast.success(t.common.copied);
              }}
              className="flex-shrink-0 text-muted-foreground/60 hover:text-foreground transition-colors"
              aria-label={t.common.copy}
            >
              <Copy size={11} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-6 space-y-5 text-xs">
          {/* Timeline */}
          <div>
            <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1">
              <ChevronsRight className="w-3.5 h-3.5 text-primary" />
              {t.negotiations.sectionTimeline}
            </p>
            <div className="bg-muted/30 rounded-lg border border-border px-3 py-3">
              <StateTimeline current={target.state} terminated={terminated} />
            </div>
          </div>

          {/* Basic */}
          <div>
            <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1">
              <ChevronsRight className="w-3.5 h-3.5 text-primary" />
              {t.negotiations.sectionBasic}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <InfoCard
                label={t.negotiations.col.state}
                value={
                  (t.negotiations.states as Record<string, string>)[
                    target.name
                  ] ?? target.name
                }
              />
              <InfoCard
                label={t.negotiations.col.peer}
                value={target.peer}
                mono
                copyable={target.peer}
              />
              <InfoCard label={t.negotiations.col.duration} value={target.t} />
              <InfoCard label={t.negotiations.col.time} value={target.ts} />
            </div>
          </div>

          {/* References */}
          <div>
            <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1">
              <ChevronsRight className="w-3.5 h-3.5 text-primary" />
              {t.negotiations.sectionRefs}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <InfoCard
                label={t.negotiations.col.asset}
                value={target.assetId}
                span
                mono
                copyable={target.assetId || undefined}
              />
              <InfoCard
                label={t.negotiations.agreementId}
                value={target.agreementId}
                span
                mono
                copyable={target.agreementId || undefined}
              />
              <InfoCard
                label={t.negotiations.counterPartyAddress}
                value={target.counterPartyAddress}
                span
                mono
                copyable={target.counterPartyAddress || undefined}
              />
            </div>
          </div>

          {/* Error */}
          {target.errorDetail && (
            <div>
              <p className="text-[11px] font-bold text-rose-600 dark:text-rose-400 uppercase tracking-wide mb-2 flex items-center gap-1">
                <ChevronsRight className="w-3.5 h-3.5 text-rose-500" />
                {t.negotiations.errorDetail}
              </p>
              <div className="bg-rose-50 dark:bg-rose-500/10 rounded-lg border border-rose-100 dark:border-rose-500/25 px-3 py-2">
                <p className="text-xs text-rose-700 dark:text-rose-300 break-all">
                  {target.errorDetail}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-muted/30 border-t border-border flex items-center gap-2 flex-shrink-0">
          <button
            onClick={onShowJson}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground rounded-md transition-colors"
          >
            <Code size={13} /> JSON
          </button>
          <div className="flex-1" />
          {target.name === "FINALIZED" && (
            <RoleGate permission="transaction:write">
              <button
                onClick={onTransfer}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
              >
                <Send size={13} /> {t.negotiations.startTransfer}
              </button>
            </RoleGate>
          )}
          {target.name === "TERMINATED" && (
            <button
              onClick={onError}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-rose-100 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300 rounded-lg hover:bg-rose-200 dark:hover:bg-rose-500/25 transition-colors"
            >
              <AlertCircle size={13} /> {t.negotiations.errorDetail}
            </button>
          )}
          {!isTerminal && (
            <RoleGate permission="transaction:write">
              <button
                onClick={onTerminate}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-rose-600 text-white rounded-lg hover:bg-rose-700 transition-colors"
              >
                <XCircle size={13} /> {t.negotiations.terminate}
              </button>
            </RoleGate>
          )}
          <button
            onClick={onClose}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium border border-border text-foreground rounded-lg hover:bg-muted transition-colors"
          >
            <X size={13} /> {t.common.close}
          </button>
        </div>
      </aside>
    </>
  );
}

/* ─── State Timeline ─────────────────────────────────────────── */
const TIMELINE_STATES: { code: number; name: string; short: string }[] = [
  { code: 100, name: "INITIAL", short: "INIT" },
  { code: 200, name: "REQUESTING", short: "REQ" },
  { code: 400, name: "OFFERED", short: "OFFER" },
  { code: 600, name: "ACCEPTED", short: "ACC" },
  { code: 800, name: "AGREED", short: "AGREE" },
  { code: 1000, name: "VERIFIED", short: "VERIFY" },
  { code: 1200, name: "FINALIZED", short: "FINAL" },
];

// Vertical stepper — fits the narrow detail slide panel without horizontal
// overflow, and shows full state names for legibility.
function StateTimeline({
  current,
  terminated,
}: {
  current: number;
  terminated: boolean;
}) {
  const { t } = useI18n();
  // EDC는 TERMINATED(1300)로 전이하면서 종료 직전 진행 상태를 보존하지 않는다.
  // 따라서 current(=1300)만으로는 어느 단계에서 실패했는지 복원할 수 없으므로,
  // 종료 시 진행 단계를 임의로 '완료(녹색)'로 칠하지 않고 전부 미도달(회색)로 두고
  // 맨 아래 TERMINATED만 빨강으로 표시한다(거짓 '전부 성공' 오해 제거).
  return (
    <div className="flex flex-col">
      {TIMELINE_STATES.map((s, idx) => {
        const reached = !terminated && current >= s.code;
        const isCurrent = current === s.code && !terminated;
        const isLast = idx === TIMELINE_STATES.length - 1 && !terminated;
        const completed = reached && !isCurrent;
        const dotClass = reached
          ? isCurrent
            ? "bg-primary border-primary ring-2 ring-primary/30"
            : "bg-primary border-primary"
          : "bg-card border-border";
        const nextReached =
          !terminated &&
          idx < TIMELINE_STATES.length - 1 &&
          current >= TIMELINE_STATES[idx + 1].code;
        const lineClass = nextReached ? "bg-primary" : "bg-border";
        const labelClass = isCurrent
          ? "text-primary font-semibold"
          : reached
            ? "text-foreground font-medium"
            : "text-muted-foreground/50 font-medium";
        return (
          <div key={s.code} className="flex gap-2.5">
            <div className="flex flex-col items-center">
              <div
                className={`w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 mt-0.5 flex items-center justify-center ${dotClass}`}
              >
                {completed && (
                  <Check className="w-2 h-2 text-white" strokeWidth={4} />
                )}
              </div>
              {!isLast && (
                <div className={`w-0.5 flex-1 min-h-[14px] ${lineClass}`} />
              )}
            </div>
            <div className={isLast ? "" : "pb-3"}>
              <span className={`text-[12px] tracking-wide ${labelClass}`}>
                {(t.negotiations.states as Record<string, string>)[s.name] ??
                  s.name}
              </span>
            </div>
          </div>
        );
      })}
      {terminated && (
        <div className="flex gap-2.5">
          <div className="flex flex-col items-center">
            <div className="w-3.5 h-3.5 rounded-full border-2 bg-rose-500 border-rose-500 ring-2 ring-rose-300/40 flex-shrink-0 mt-0.5" />
          </div>
          <div>
            <span className="text-[12px] font-semibold tracking-wide text-rose-600 dark:text-rose-400">
              {(t.negotiations.states as Record<string, string>).TERMINATED ??
                "TERMINATED"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── JSON Viewer (ContractNegotiation envelope) ─────────────── */
function NegotiationJsonDialog({
  negotiation,
  onClose,
}: {
  negotiation: Negotiation;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const envelope = {
    "@context": { "@vocab": "https://w3id.org/edc/v0.0.1/ns/" },
    "@id": negotiation.id,
    "@type": "ContractNegotiation",
    protocol: negotiation.protocol ?? "dataspace-protocol-http:2025-1",
    state: negotiation.name,
    stateCode: negotiation.state,
    counterPartyId: negotiation.peer,
    counterPartyAddress: negotiation.counterPartyAddress ?? null,
    assetId: negotiation.assetId ?? null,
    contractAgreementId: negotiation.agreementId ?? null,
    duration: negotiation.t,
    timestamp: negotiation.ts,
    errorDetail: negotiation.errorDetail ?? null,
  };
  return (
    <JsonViewerDialog
      open={true}
      onClose={onClose}
      title={t.negotiations.jsonTitle}
      subtitle={`${negotiation.id.slice(0, 16)}…`}
      json={JSON.stringify(envelope, null, 2)}
      downloadName={negotiation.id}
    />
  );
}

/* ─── Negotiation Card (Mobile) ─────────────────────────────── */
function NegotiationCard({
  negotiation: n,
  onSelect,
}: {
  negotiation: Negotiation;
  onSelect: (n: Negotiation) => void;
}) {
  const { t } = useI18n();
  return (
    <div
      {...clickable(() => onSelect(n))}
      className="bg-card rounded-xl p-4 shadow-sm border border-border cursor-pointer"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <StateBadge name={n.name} />
          <span className="text-xs text-foreground">{n.id.slice(0, 12)}</span>
        </div>
        <button
          onClick={e => {
            e.stopPropagation();
            navigator.clipboard.writeText(n.id);
            toast.success(t.common.copied);
          }}
          aria-label={t.common.copy ?? "Copy"}
        >
          <Copy className="w-3 h-3 text-muted-foreground" />
        </button>
      </div>
      <div className="flex items-center gap-3 text-xs text-foreground">
        <span className="text-xs text-foreground break-all min-w-0">
          {n.peer}
        </span>
        <span className="text-xs text-foreground">{n.t}</span>
        <span className="text-xs text-foreground ml-auto">{n.ts}</span>
      </div>
      {n.assetId && (
        <div className="mt-1 flex items-center gap-1 text-xs text-foreground">
          <span className="uppercase tracking-wide text-[11px] text-muted-foreground">
            {t.negotiations.col.asset}:
          </span>
          <span className="text-xs font-bold text-primary truncate">
            {n.assetId}
          </span>
        </div>
      )}
    </div>
  );
}
