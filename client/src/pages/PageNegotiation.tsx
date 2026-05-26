// Connector Hub — Contract Negotiation Page (spec 4.5)
// FSM state polling, KPI cards, filter buttons, responsive table/card

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { fetchNegotiations, terminateNegotiation } from "@/services";
import { NEG_STATE_MAP, type Negotiation } from "@/lib/data";
import { useConnectorStore } from "@/stores/connectorStore";
import { Pagination, paginate } from "@/components/Pagination";
import {
  Card, KpiCard, StateBadge, MonoText, SectionHdr,
  ListCard, ListHeaderRow, ListRow, ListColLabel, ListEmpty,
} from "@/components/ui-kmx";

const NEG_COLS = "grid-cols-[150px_104px_1.2fr_1.3fr_72px_1.3fr_180px]";
import { DetailPanel, ConfirmActionDialog, JsonViewerDialog } from "@/components/DetailDeleteDialogs";
import { FileText, Send, AlertCircle, Copy, XCircle, Search, Loader2, RefreshCw, Clock } from "lucide-react";
import { toast } from "sonner";
import { RoleGate } from "@/components/RoleGate";


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
  const connector = useConnectorStore((s) => s.connector);
  const connectorId = connector?.id;
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<FilterKey>("ALL");
  const [search, setSearch] = useState("");
  const [timeRange, setTimeRange] = useState<TimeRange>("ALL");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Terminate modal state
  const [terminateTarget, setTerminateTarget] = useState<Negotiation | null>(null);
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
      queryClient.invalidateQueries({ queryKey: ["negotiations", connectorId] });
    },
    onError: () => {
      toast.error(t.negotiations.terminateFailed);
    },
  });

  const { data: negotiations = [], isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["negotiations", connectorId],
    queryFn: () => fetchNegotiations(connectorId!),
    enabled: !!connectorId,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data?.some((n) => n.state < 1200)) return 3000;
      return false;
    },
  });

  const kpi = useMemo(() => ({
    finalized:  negotiations.filter((n) => n.name === "FINALIZED").length,
    requesting: negotiations.filter((n) => n.name === "REQUESTING").length,
    agreed:     negotiations.filter((n) => n.name === "AGREED").length,
    terminated: negotiations.filter((n) => n.name === "TERMINATED").length,
  }), [negotiations]);

  const rows = useMemo(() => {
    let filtered = filter === "ALL" ? negotiations : negotiations.filter((n) => n.name === filter);

    // Search by id / peer / assetId / agreementId
    const q = search.trim().toLowerCase();
    if (q) {
      filtered = filtered.filter((n) =>
        n.id.toLowerCase().includes(q) ||
        (n.peer ?? "").toLowerCase().includes(q) ||
        (n.assetId ?? "").toLowerCase().includes(q) ||
        (n.agreementId ?? "").toLowerCase().includes(q)
      );
    }

    // Time range filter (based on n.ts string parseable as Date)
    const range = TIME_RANGES.find((r) => r.value === timeRange);
    if (range?.days != null) {
      const cutoff = Date.now() - range.days * 86400_000;
      filtered = filtered.filter((n) => {
        const ts = Date.parse(n.ts);
        return Number.isFinite(ts) ? ts >= cutoff : true;
      });
    }

    // 최신 시각(ts) 내림차순 정렬
    return [...filtered].sort((a, b) => b.ts.localeCompare(a.ts));
  }, [negotiations, filter, search, timeRange]);

  const filters: FilterKey[] = ["ALL", "FINALIZED", "REQUESTING", "AGREED", "TERMINATED"];

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
        onClose={() => { setTerminateTarget(null); setTerminateReason(""); }}
        title={t.negotiations.terminate}
        description={t.negotiations.terminateConfirm}
        subtitle={terminateTarget?.id}
        tone="danger"
        confirmLabel={t.negotiations.terminate}
        loading={terminateMutation.isPending}
        input={{
          placeholder: t.negotiations.terminateReasonPlaceholderRequired,
          helper: <><span className="text-rose-500">*</span> {t.negotiations.reasonRequiredHint}</>,
          value: terminateReason,
          onChange: setTerminateReason,
          autoFocus: true,
        }}
        onConfirm={() => { if (terminateTarget) terminateMutation.mutate(terminateTarget); }}
      />

      <SectionHdr icon={<FileText className="w-5 h-5 text-primary" />} breadcrumb={connector ? `${connector.name} / ${connector.bpn}` : undefined}>{t.negotiations.title}</SectionHdr>
      {/* ── Search & Filter — fl-aggregator TasksPage style ───── */}
      <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder={t.negotiations.searchPlaceholder}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full pl-8 pr-3 py-1.5 text-[12px] border border-border rounded-md bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {filters.map((f) => (
            <button
              key={f}
              onClick={() => { setFilter(f); setPage(1); }}
              className={`px-3 py-1.5 rounded-full text-[11px] font-medium transition-all duration-150 border ${
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
          {TIME_RANGES.map((r) => (
            <button
              key={r.value}
              onClick={() => { setTimeRange(r.value); setPage(1); }}
              className={`px-3 py-1.5 rounded-full text-[11px] font-medium transition-all duration-150 border ${
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

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_280px] gap-3">
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
              <div className="flex flex-col items-center justify-center py-10 gap-3">
                <div className="flex items-center gap-2 text-rose-600">
                  <AlertCircle className="w-4 h-4" />
                  <span className="text-[13px] font-medium">{t.common.loadFailed}</span>
                </div>
                <button
                  onClick={() => refetch()}
                  disabled={isFetching}
                  className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-md border border-border hover:bg-muted text-foreground/80 disabled:opacity-50"
                >
                  <RefreshCw className={`w-3 h-3 ${isFetching ? "animate-spin" : ""}`} />
                  {t.common.retry}
                </button>
              </div>
            </Card>
          )}

          {!isLoading && !isError && (
          <>
          {/* Desktop: List — fl-aggregator ListCard */}
          <ListCard
            title={t.negotiations.listTitle}
            actions={<span className="text-[11px] text-muted-foreground">{t.negotiations.resultCount(rows.length, negotiations.length)}</span>}
            className="hidden md:block"
          >
            <ListHeaderRow cols={NEG_COLS}>
              <ListColLabel>{t.negotiations.col.id}</ListColLabel>
              <ListColLabel>{t.negotiations.col.state}</ListColLabel>
              <ListColLabel>{t.negotiations.col.peer}</ListColLabel>
              <ListColLabel>{t.negotiations.col.asset}</ListColLabel>
              <ListColLabel>{t.negotiations.col.duration}</ListColLabel>
              <ListColLabel>{t.negotiations.col.time}</ListColLabel>
              <ListColLabel>{t.negotiations.col.action}</ListColLabel>
            </ListHeaderRow>
            {rows.length === 0 ? (
              <ListEmpty icon={<FileText />} message={t.negotiations.noResults} />
            ) : (
              paginate(rows, page, pageSize).map((n) => (
              <ListRow key={n.id} cols={NEG_COLS} onClick={() => setDetailTarget(n)}>
                <div className="flex items-center gap-1 min-w-0">
                  <MonoText className="!text-[12px] !font-normal truncate">{n.id.slice(0, 12)}</MonoText>
                  <button
                    onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(n.id); toast.success(t.common.copied); }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                  >
                    <Copy className="w-3 h-3 text-muted-foreground hover:text-foreground" />
                  </button>
                </div>
                <div>
                  <StateBadge name={n.name} />
                </div>
                <div className="min-w-0">
                  <MonoText className="!text-[12px] !font-normal block truncate">{n.peer}</MonoText>
                </div>
                <div className="min-w-0">
                  {n.assetId ? (
                    <MonoText className="!text-[12px] !font-normal block truncate">{n.assetId}</MonoText>
                  ) : (
                    <span className="text-[12px] text-muted-foreground/50">—</span>
                  )}
                </div>
                <div className="text-[12px] font-normal text-muted-foreground">{n.t}</div>
                <div className="text-[12px] font-normal text-muted-foreground truncate">{n.ts}</div>
                <div onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {n.name === "FINALIZED" && (
                      <RoleGate permission="transaction:write">
                        <button
                          onClick={() => handleTransferStart(n)}
                          className="text-[11px] px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-medium transition-colors whitespace-nowrap"
                        >
                          {t.negotiations.startTransfer}
                        </button>
                      </RoleGate>
                    )}
                    {n.name === "TERMINATED" && (
                      <button
                        onClick={() => handleTerminatedDetail(n)}
                        className="text-[11px] px-2 py-1 rounded bg-rose-100 hover:bg-rose-200 text-rose-700 font-medium transition-colors whitespace-nowrap"
                      >
                        {t.negotiations.errorDetail}
                      </button>
                    )}
                    {!TERMINAL_STATES.has(n.name) && (
                      <RoleGate permission="transaction:write">
                        <button
                          onClick={() => { setTerminateTarget(n); setTerminateReason(""); }}
                          className="text-[11px] px-2 py-1 rounded bg-rose-50 hover:bg-rose-100 border border-rose-300 text-rose-600 font-medium transition-colors whitespace-nowrap flex items-center gap-1"
                        >
                          <XCircle className="w-3 h-3" />
                          {t.negotiations.terminate}
                        </button>
                      </RoleGate>
                    )}
                  </div>
                </div>
              </ListRow>
              )))}
            {rows.length > 0 && (
              <div className="px-4 py-2 border-t border-border/60 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="flex items-center gap-1">
                  {[10, 20, 50].map((size) => (
                    <button
                      key={size}
                      onClick={() => { setPageSize(size); setPage(1); }}
                      className={`text-[11px] px-2 py-0.5 rounded-md border transition-colors ${
                        pageSize === size
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-card border-border text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      {size}건
                    </button>
                  ))}
                </div>
                <Pagination total={rows.length} page={page} pageSize={pageSize} onPageChange={setPage} />
              </div>
            )}
          </ListCard>

          {/* Mobile: Card Stack */}
          <div className="md:hidden flex flex-col gap-3">
            {paginate(rows, page, pageSize).map((n) => (
              <NegotiationCard
                key={n.id}
                negotiation={n}
                onSelect={setDetailTarget}
                onTransfer={handleTransferStart}
                onError={handleTerminatedDetail}
                onTerminate={(neg) => { setTerminateTarget(neg); setTerminateReason(""); }}
              />
            ))}
            {rows.length === 0 && (
              <ListEmpty icon={<FileText />} message={t.negotiations.noResults} />
            )}
            <Pagination total={rows.length} page={page} pageSize={pageSize} onPageChange={setPage} />
          </div>
          </>
          )}
        </div>

        {/* Detail Dialog */}
        {detailTarget && (
          <DetailPanel
            open={!!detailTarget}
            onClose={() => setDetailTarget(null)}
            title={detailTarget.id}
            icon={<FileText className="w-4 h-4 text-primary" />}
            subtitle={detailTarget.name}
            sections={[
              {
                title: t.negotiations.sectionTimeline,
                fields: [
                  { label: t.negotiations.progress, value: <StateTimeline current={detailTarget.state} terminated={detailTarget.name === "TERMINATED"} /> },
                ],
              },
              {
                title: t.negotiations.sectionBasic,
                fields: [
                  { label: t.negotiations.col.id, value: detailTarget.id, mono: true, copyable: true },
                  { label: t.negotiations.col.state, value: "", badge: { text: `${detailTarget.name} (${detailTarget.state})`, variant: detailTarget.name === "FINALIZED" ? "green" : detailTarget.name === "TERMINATED" ? "red" : "blue" } },
                  { label: t.negotiations.col.peer, value: detailTarget.peer, mono: true, copyable: true },
                  { label: t.negotiations.col.duration, value: detailTarget.t },
                  { label: t.negotiations.col.time, value: detailTarget.ts },
                ],
              },
              {
                title: t.negotiations.sectionRefs,
                fields: [
                  { label: t.negotiations.col.asset, value: detailTarget.assetId || "—", mono: !!detailTarget.assetId, copyable: !!detailTarget.assetId },
                  { label: t.negotiations.agreementId, value: detailTarget.agreementId || "—", mono: !!detailTarget.agreementId, copyable: !!detailTarget.agreementId },
                  { label: t.negotiations.counterPartyAddress, value: detailTarget.counterPartyAddress || "—", mono: !!detailTarget.counterPartyAddress, copyable: !!detailTarget.counterPartyAddress },
                ],
              },
              ...(detailTarget.errorDetail ? [{
                title: t.negotiations.errorDetail,
                fields: [{ label: t.negotiations.errorMessage, value: detailTarget.errorDetail, badge: { text: t.negotiations.terminated, variant: "red" } }],
              }] : []),
            ]}
            onShowJson={() => { setJsonTarget(detailTarget); setDetailTarget(null); }}
          />
        )}

        {/* JSON Viewer */}
        {jsonTarget && <NegotiationJsonDialog negotiation={jsonTarget} onClose={() => setJsonTarget(null)} />}

        {/* State Code Map */}
        <Card title={t.negotiations.fsmMapping}>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-2 gap-2">
            {Object.entries(NEG_STATE_MAP).map(([code, info]) => (
              <div key={code} className="bg-muted rounded-md p-2">
                <div className="flex items-center gap-1.5">
                  <span className="mono text-[11px] text-muted-foreground">{code}</span>
                  <StateBadge name={info.name} />
                </div>
                <div className="text-[11px] text-muted-foreground mt-1">{info.label}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>
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
function StateTimeline({ current, terminated }: { current: number; terminated: boolean }) {
  const termIdx = terminated ? TIMELINE_STATES.findIndex((x) => x.code > current) : -1;
  return (
    <div className="flex flex-col">
      {TIMELINE_STATES.map((s, idx) => {
        const reached = current >= s.code;
        const isCurrent = current === s.code && !terminated;
        const isLast = idx === TIMELINE_STATES.length - 1 && !terminated;
        const failed = terminated && termIdx >= 0 && idx >= termIdx;
        const dotClass = failed
          ? "bg-rose-500 border-rose-500"
          : reached
            ? isCurrent
              ? "bg-primary border-primary ring-2 ring-primary/30"
              : "bg-primary border-primary"
            : "bg-card border-border";
        const nextReached = idx < TIMELINE_STATES.length - 1 && current >= TIMELINE_STATES[idx + 1].code;
        const lineClass = terminated && termIdx >= 0 && idx >= termIdx
          ? "bg-rose-300"
          : nextReached ? "bg-primary" : "bg-border";
        const labelClass = failed
          ? "text-rose-600 font-medium"
          : isCurrent
            ? "text-primary font-semibold"
            : reached
              ? "text-foreground font-medium"
              : "text-muted-foreground/50 font-medium";
        return (
          <div key={s.code} className="flex gap-2.5">
            <div className="flex flex-col items-center">
              <div className={`w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 mt-0.5 ${dotClass}`} />
              {!isLast && <div className={`w-0.5 flex-1 min-h-[14px] ${lineClass}`} />}
            </div>
            <div className={isLast ? "" : "pb-3"}>
              <span className={`text-[12px] tracking-wide ${labelClass}`}>{s.name}</span>
              <span className="text-[10px] font-mono text-muted-foreground/60 ml-1.5">{s.code}</span>
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
            <span className="text-[12px] font-semibold tracking-wide text-rose-600">TERMINATED</span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── JSON Viewer (ContractNegotiation envelope) ─────────────── */
function NegotiationJsonDialog({ negotiation, onClose }: { negotiation: Negotiation; onClose: () => void }) {
  const { t } = useI18n();
  const envelope = {
    "@context": { "@vocab": "https://w3id.org/edc/v0.0.1/ns/" },
    "@id": negotiation.id,
    "@type": "ContractNegotiation",
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
  onTransfer,
  onError,
  onTerminate,
}: {
  negotiation: Negotiation;
  onSelect: (n: Negotiation) => void;
  onTransfer: (n: Negotiation) => void;
  onError: (n: Negotiation) => void;
  onTerminate: (n: Negotiation) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="bg-card rounded-xl p-4 shadow-sm border border-border cursor-pointer" onClick={() => onSelect(n)}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <StateBadge name={n.name} />
          <MonoText className="text-[11px]">{n.id.slice(0, 12)}</MonoText>
        </div>
        <button onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(n.id); toast.success(t.common.copied); }}>
          <Copy className="w-3 h-3 text-muted-foreground" />
        </button>
      </div>
      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
        <MonoText className="text-[11px]">{n.peer}</MonoText>
        <span>{n.t}</span>
        <span className="ml-auto">{n.ts}</span>
      </div>
      {n.assetId && (
        <div className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
          <span className="uppercase tracking-wide text-[11px]">{t.negotiations.col.asset}:</span>
          <MonoText className="text-[11px]">{n.assetId}</MonoText>
        </div>
      )}
      {n.name === "FINALIZED" && (
        <RoleGate permission="transaction:write">
          <button
            onClick={(e) => { e.stopPropagation(); onTransfer(n); }}
            className="mt-2 w-full text-[11px] py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-medium transition-colors"
          >
            {t.negotiations.startTransfer}
          </button>
        </RoleGate>
      )}
      {n.name === "TERMINATED" && (
        <button
          onClick={(e) => { e.stopPropagation(); onError(n); }}
          className="mt-2 w-full text-[11px] py-1.5 rounded bg-rose-100 hover:bg-rose-200 text-rose-700 font-medium transition-colors"
        >
          {t.negotiations.errorDetail}
        </button>
      )}
      {!TERMINAL_STATES.has(n.name) && (
        <RoleGate permission="transaction:write">
          <button
            onClick={(e) => { e.stopPropagation(); onTerminate(n); }}
            className="mt-2 w-full text-[11px] py-1.5 rounded bg-rose-50 hover:bg-rose-100 border border-rose-300 text-rose-600 font-medium transition-colors flex items-center justify-center gap-1"
          >
            <XCircle className="w-3 h-3" />
            {t.negotiations.terminate}
          </button>
        </RoleGate>
      )}
    </div>
  );
}
