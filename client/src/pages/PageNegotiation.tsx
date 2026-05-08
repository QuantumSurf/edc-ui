// Connector Hub — Contract Negotiation Page (spec 4.5)
// FSM state polling, KPI cards, filter buttons, responsive table/card

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { fetchNegotiations, terminateNegotiation } from "@/services";
import { NEG_STATE_MAP, type Negotiation } from "@/lib/data";
import { useConnectorStore } from "@/stores/connectorStore";
import { Pagination, paginate } from "@/components/Pagination";
import { Card, KpiCard, StateBadge, MonoText, SectionHdr } from "@/components/ui-kmx";
import { DetailDialog, ConfirmActionDialog, JsonViewerDialog } from "@/components/DetailDeleteDialogs";
import { FileText, Send, AlertCircle, Copy, Filter, XCircle, Search, Loader2, RefreshCw, Clock } from "lucide-react";
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

      <SectionHdr breadcrumb={connector ? `${connector.name} / ${connector.bpn}` : undefined}>{t.negotiations.title}</SectionHdr>
      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          icon={<FileText className="w-[18px] h-[18px] text-emerald-600" />}
          iconBg="bg-emerald-50"
          label={t.negotiations.states.FINALIZED}
          value={kpi.finalized}
          valueColor="text-emerald-600"
        />
        <KpiCard
          icon={<Send className="w-[18px] h-[18px] text-blue-600" />}
          iconBg="bg-blue-50"
          label={t.negotiations.states.REQUESTING}
          value={kpi.requesting}
          valueColor="text-blue-600"
        />
        <KpiCard
          icon={<FileText className="w-[18px] h-[18px] text-teal-600" />}
          iconBg="bg-teal-50"
          label={t.negotiations.states.AGREED}
          value={kpi.agreed}
          valueColor="text-teal-600"
        />
        <KpiCard
          icon={<AlertCircle className="w-[18px] h-[18px] text-rose-600" />}
          iconBg="bg-rose-50"
          label={t.negotiations.states.TERMINATED}
          value={kpi.terminated}
          valueColor="text-rose-600"
        />
      </div>


      <div className="grid grid-cols-1 xl:grid-cols-[1fr_280px] gap-3">
        {/* Negotiation List */}
        <Card title={t.negotiations.listTitle}>

          {/* ── Search + Filter Bar ─────────────────────────────── */}
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input
                type="text"
                placeholder={t.negotiations.searchPlaceholder}
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                className="w-full pl-8 pr-3 py-1.5 text-[12px] border border-border rounded-md bg-card focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div className="flex items-center gap-1 border-l border-border pl-2">
              <Clock className="w-3 h-3 text-muted-foreground flex-shrink-0" />
              {TIME_RANGES.map((r) => (
                <button
                  key={r.value}
                  onClick={() => { setTimeRange(r.value); setPage(1); }}
                  className={`text-[11px] px-2 py-1 rounded border transition-colors ${
                    timeRange === r.value
                      ? "bg-primary text-primary-foreground border-primary font-medium"
                      : "border-border text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {r.value === "ALL" ? t.common.all : r.value}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap mb-3">
            <Filter className="w-3 h-3 text-muted-foreground flex-shrink-0" />
            {filters.map((f) => (
              <button
                key={f}
                onClick={() => { setFilter(f); setPage(1); }}
                className={`text-[11px] px-2 py-1 rounded-full border transition-colors ${
                  filter === f
                    ? "bg-primary text-primary-foreground border-primary font-medium"
                    : "border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                {filterLabel(f)}
              </button>
            ))}
            <span className="text-[11px] text-muted-foreground ml-auto">
              {t.negotiations.resultCount(rows.length, negotiations.length)}
            </span>
            {/* 페이지 크기 선택 */}
            <div className="flex items-center gap-1 border-l border-border pl-2">
              {[10, 20, 50].map((size) => (
                <button
                  key={size}
                  onClick={() => { setPageSize(size); setPage(1); }}
                  className={`text-[11px] px-2 py-1 rounded border transition-colors ${
                    pageSize === size
                      ? "bg-primary text-primary-foreground border-primary font-medium"
                      : "border-border text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {size}건
                </button>
              ))}
            </div>
          </div>

          {/* Loading state */}
          {isLoading && (
            <div className="flex items-center justify-center py-10 gap-2 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-[13px]">{t.common.loading}</span>
            </div>
          )}

          {/* Error state */}
          {!isLoading && isError && (
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
          )}

          {!isLoading && !isError && (
          <>
          {/* Desktop: Table */}
          <div className="hidden md:block overflow-x-auto rounded-lg border border-border">
            <table className="w-full">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  {[t.negotiations.col.id, t.negotiations.col.state, t.negotiations.col.peer, t.negotiations.col.asset, t.negotiations.col.duration, t.negotiations.col.time, t.negotiations.col.action].map((h) => (
                    <th key={h} className="text-left !text-[12px] px-4 py-3 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {paginate(rows, page, pageSize).map((n) => (
                  <tr key={n.id} onClick={() => setDetailTarget(n)} className="hover:bg-muted/30 transition-colors group cursor-pointer">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <MonoText className="!text-[12px] !font-normal">{n.id.slice(0, 12)}</MonoText>
                        <button
                          onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(n.id); toast.success(t.common.copied); }}
                          className="opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Copy className="w-3 h-3 text-muted-foreground hover:text-foreground" />
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <StateBadge name={n.name} />
                    </td>
                    <td className="px-4 py-3">
                      <MonoText className="!text-[12px] !font-normal">{n.peer}</MonoText>
                    </td>
                    <td className="px-4 py-3">
                      {n.assetId ? (
                        <MonoText className="!text-[12px] !font-normal">{n.assetId}</MonoText>
                      ) : (
                        <span className="!text-[12px] text-muted-foreground/50">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="!text-[12px] font-normal text-muted-foreground">{n.t}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="!text-[12px] font-normal text-muted-foreground">{n.ts}</span>
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

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
          </div>

          {rows.length === 0 && (
            <div className="text-center py-6 text-[12px] text-muted-foreground">
              {t.negotiations.noResults}
            </div>
          )}
          <Pagination total={rows.length} page={page} pageSize={pageSize} onPageChange={setPage} />
          </>
          )}
        </Card>

        {/* Detail Dialog */}
        {detailTarget && (
          <DetailDialog
            open={!!detailTarget}
            onClose={() => setDetailTarget(null)}
            title={detailTarget.id}
            subtitle={`${detailTarget.name}  ·  ${detailTarget.peer}`}
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

function StateTimeline({ current, terminated }: { current: number; terminated: boolean }) {
  return (
    <div className="w-full overflow-x-auto">
      <div className="flex items-center gap-0 min-w-[520px] py-2">
        {TIMELINE_STATES.map((s, idx) => {
          const reached = current >= s.code;
          const isCurrent = current === s.code && !terminated;
          const dotClass = terminated && idx >= TIMELINE_STATES.findIndex((x) => x.code > current)
            ? "bg-rose-500 border-rose-500"
            : reached
              ? isCurrent
                ? "bg-primary border-primary ring-2 ring-primary/30"
                : "bg-primary border-primary"
              : "bg-card border-border";
          const lineClass = idx < TIMELINE_STATES.length - 1
            ? (current >= TIMELINE_STATES[idx + 1].code ? "bg-primary" : terminated && current < TIMELINE_STATES[idx + 1].code ? "bg-rose-200" : "bg-border")
            : "";
          return (
            <div key={s.code} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center gap-1 flex-shrink-0">
                <div className={`w-3 h-3 rounded-full border-2 ${dotClass}`} />
                <div className={`text-[11px] font-medium uppercase tracking-wider whitespace-nowrap ${reached ? "text-foreground" : "text-muted-foreground/50"}`}>
                  {s.short}
                </div>
              </div>
              {idx < TIMELINE_STATES.length - 1 && (
                <div className={`h-0.5 flex-1 mx-1 ${lineClass}`} />
              )}
            </div>
          );
        })}
        {terminated && (
          <div className="flex items-center ml-2">
            <div className="h-0.5 w-3 bg-rose-300" />
            <div className="flex flex-col items-center gap-1 flex-shrink-0 ml-1">
              <div className="w-3 h-3 rounded-full border-2 bg-rose-500 border-rose-500 ring-2 ring-rose-300/40" />
              <div className="text-[11px] font-medium uppercase tracking-wider whitespace-nowrap text-rose-600">TERM</div>
            </div>
          </div>
        )}
      </div>
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
