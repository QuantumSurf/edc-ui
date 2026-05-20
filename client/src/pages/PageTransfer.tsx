// Connector Hub — Data Transfer Page (spec 4.6)
// TanStack Query polling, FSM badges, unified list, DataSink start form, KPI cards

import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearch } from "wouter";
import { useI18n } from "@/i18n";
import { fetchTransfers, startTransfer, completeTransfer, terminateTransfer, fetchTransferData, deleteAllTransfers } from "@/services";
import { TRANSFER_STATE_MAP, SINK_TYPES, type Transfer } from "@/lib/data";
import { useConnectorStore } from "@/stores/connectorStore";
import { Pagination, paginate } from "@/components/Pagination";
import {
  Card, KpiCard, StateBadge, MonoText, SectionHdr, Badge, FormField,
} from "@/components/ui-kmx";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Send, ArrowRightLeft, Clock, HardDrive, Filter, CheckCircle, XCircle, Download, Trash2, FileText } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { RoleGate } from "@/components/RoleGate";

/* ── helpers ──────────────────────────────────────────────────── */
const INPUT_CLS =
  "w-full text-[12px] px-2.5 py-1.5 border border-border rounded bg-card focus:outline-none focus:ring-1 focus:ring-primary";

const ALL_STATE_FILTERS = ["ALL", "REQUESTING", "STARTED", "SUSPENDED", "COMPLETED", "TERMINATED"] as const;
type StateFilter = typeof ALL_STATE_FILTERS[number];

/* ── 데이터 뷰어 모달 ─────────────────────────────────────────── */
interface DataViewerProps {
  tpId: string;
  asset: string;
  data: unknown;
  sizeBytes: number;
  contentType: string;
  onClose: () => void;
}

function DataViewer({ tpId, asset, data, sizeBytes, contentType, onClose }: DataViewerProps) {
  const { t } = useI18n();
  const isJson = contentType.includes("json") || (typeof data === "object" && data !== null);
  const formatted = isJson
    ? JSON.stringify(data, null, 2)
    : String(data);

  const sizeLabel = sizeBytes >= 1024 * 1024
    ? `${(sizeBytes / 1024 / 1024).toFixed(2)} MB`
    : sizeBytes >= 1024
      ? `${(sizeBytes / 1024).toFixed(1)} KB`
      : `${sizeBytes} B`;

  function handleDownload() {
    const blob = new Blob([formatted], { type: contentType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `transfer-${tpId.slice(0, 8)}.${isJson ? "json" : "txt"}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Dialog open={true} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl p-0 overflow-hidden flex flex-col max-h-[80vh]">
        <DialogHeader className="px-4 py-3 border-b border-border flex-row items-center justify-between gap-2 space-y-0">
          <div className="flex items-center gap-2 min-w-0">
            <FileText className="w-4 h-4 text-primary flex-shrink-0" />
            <DialogTitle className="font-display text-[13px] font-semibold truncate">{t.transfers.dataViewerTitle}</DialogTitle>
            <span className="text-[11px] text-muted-foreground font-mono truncate">{tpId.slice(0, 12)}</span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-[11px] text-muted-foreground hidden sm:inline">{asset}</span>
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{sizeLabel}</span>
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{contentType.split(";")[0]}</span>
            <button
              onClick={handleDownload}
              title={t.transfers.saveAsFile}
              className="p-1 rounded hover:bg-muted text-muted-foreground transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
            </button>
          </div>
        </DialogHeader>
        <div className="overflow-auto flex-1 p-4 min-h-0">
          <pre className="mono text-[12px] bg-slate-900 text-slate-300 rounded-lg p-3 overflow-auto whitespace-pre-wrap leading-relaxed break-all">
            {formatted}
          </pre>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── component ────────────────────────────────────────────────── */
export default function PageTransfer() {
  const { t } = useI18n();
  const search = useSearch();
  const qParams = useMemo(() => new URLSearchParams(search), [search]);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sinkType, setSinkType] = useState("HttpProxy");
  const [sinkEndpoint, setSinkEndpoint] = useState("");
  const [agreementId, setAgreementId] = useState(() => qParams.get("agreementId") ?? "");
  const [assetId, setAssetId] = useState(() => qParams.get("assetId") ?? "");
  const [counterPartyAddress, setCounterPartyAddress] = useState(() => qParams.get("cpa") ?? "");

  // Pre-fill form when navigated from negotiation page
  useEffect(() => {
    const a = qParams.get("agreementId") ?? "";
    const s = qParams.get("assetId") ?? "";
    const c = qParams.get("cpa") ?? "";
    if (a) setAgreementId(a);
    if (s) setAssetId(s);
    if (c) setCounterPartyAddress(c);
  }, [qParams]);

  const [submitting, setSubmitting] = useState(false);
  const [stateFilter, setStateFilter] = useState<StateFilter>("ALL");
  const [dataViewer, setDataViewer] = useState<{
    tpId: string; asset: string; data: unknown; sizeBytes: number; contentType: string;
  } | null>(null);

  // Track IDs we already toasted so we don't re-fire
  const toastedRef = useRef<Set<string>>(new Set());
  // Track IDs that were user-initiated (complete/terminate button) — suppress TERMINATED toast
  const userActionRef = useRef<Set<string>>(new Set());

  const connector = useConnectorStore((s) => s.connector);
  const connectorId = connector?.id;
  const queryClient = useQueryClient();

  // 첫 로드 여부 추적 — 초기 스냅샷의 TERMINATED는 toast 제외
  const initializedRef = useRef(false);

  /* ── query with conditional polling ─────────────────────────── */
  const { data: transfers = [] } = useQuery({
    queryKey: ["transfers", connectorId],
    queryFn: () => fetchTransfers(connectorId!),
    enabled: !!connectorId,
    refetchInterval: (query) => {
      const list = query.state.data as Transfer[] | undefined;
      const hasInflight = list?.some((tr) => tr.state < 1200);
      return hasInflight ? 3000 : false;
    },
  });

  /* ── toast on TERMINATED (신규 실패만, 기존 상태 제외) ─────── */
  useEffect(() => {
    if (transfers.length === 0) return;

    if (!initializedRef.current) {
      // 첫 로드: 이미 TERMINATED/완료된 항목을 toastedRef에 등록 → toast 억제
      transfers.forEach((tr) => {
        if (tr.state >= 1200) toastedRef.current.add(tr.id);
      });
      initializedRef.current = true;
      return;
    }

    // 이후 폴링: 새로 TERMINATED된 항목만 toast
    transfers.forEach((tr) => {
      if (tr.state === 1300 && !toastedRef.current.has(tr.id)) {
        toastedRef.current.add(tr.id);
        if (!userActionRef.current.has(tr.id)) {
          toast.error(t.transfers.transferFailedToast(tr.id.slice(0, 12), tr.asset), {
            description: tr.errorDetail || undefined,
          });
        }
      }
    });
  }, [transfers]);

  /* ── derived data ───────────────────────────────────────────── */
  const completedCount = transfers.filter((tr: Transfer) => tr.state >= 1200).length;
  const inflightCount  = transfers.filter((tr: Transfer) => tr.state < 1200).length;

  const totalVolume = transfers
    .filter((tr: Transfer) => tr.size !== "—")
    .reduce((sum: number, tr: Transfer) => {
      const m = tr.size.match(/([\d.]+)\s*MB/);
      return sum + (m ? parseFloat(m[1]) : 0);
    }, 0);
  const durations = transfers
    .filter((tr: Transfer) => tr.t !== "—")
    .map((tr: Transfer) => parseFloat(tr.t));
  const avgDuration =
    durations.length > 0
      ? (durations.reduce((a: number, b: number) => a + b, 0) / durations.length).toFixed(1)
      : "—";

  const rows = useMemo(() => {
    const filtered = stateFilter === "ALL" ? transfers : transfers.filter((tr) => tr.name === stateFilter);
    // 전송 시작 시각(startedAt) 내림차순 정렬 — "—"은 뒤로
    return [...filtered].sort((a, b) => {
      const ta = a.startedAt ?? "";
      const tb = b.startedAt ?? "";
      if (!ta && !tb) return 0;
      if (!ta) return 1;
      if (!tb) return -1;
      return tb.localeCompare(ta);
    });
  }, [transfers, stateFilter]);

  /* ── complete / terminate handlers ─────────────────────────── */
  async function handleComplete(tpId: string) {
    if (!connectorId || !window.confirm(t.transfers.completeConfirm)) return;
    try {
      userActionRef.current.add(tpId);
      toastedRef.current.add(tpId);
      await completeTransfer(tpId, connectorId);
      toast.success(t.transfers.completeSuccess);
      queryClient.invalidateQueries({ queryKey: ["transfers", connectorId] });
    } catch {
      userActionRef.current.delete(tpId);
      toast.error(t.transfers.actionFailed);
    }
  }

  async function handleDeleteAll() {
    if (!connectorId || !window.confirm(t.transfers.deleteAllConfirm)) return;
    try {
      const { deleted } = await deleteAllTransfers(connectorId);
      toast.success(t.transfers.deleteAllSuccess(deleted));
      queryClient.invalidateQueries({ queryKey: ["transfers", connectorId] });
    } catch {
      toast.error(t.transfers.actionFailed);
    }
  }

  async function handleFetch(tpId: string, asset: string) {
    if (!connectorId) return;
    try {
      const result = await fetchTransferData(tpId, connectorId);
      // 모달 표시
      setDataViewer({ tpId, asset, data: result.data, sizeBytes: result.sizeBytes, contentType: result.contentType });
      queryClient.invalidateQueries({ queryKey: ["transfers", connectorId] });
    } catch {
      toast.error(t.transfers.fetchFailed);
    }
  }

  async function handleTerminate(tpId: string) {
    if (!connectorId || !window.confirm(t.transfers.terminateConfirm)) return;
    try {
      userActionRef.current.add(tpId);
      toastedRef.current.add(tpId);
      await terminateTransfer(tpId, connectorId);
      toast.success(t.transfers.terminateSuccess);
      queryClient.invalidateQueries({ queryKey: ["transfers", connectorId] });
    } catch {
      userActionRef.current.delete(tpId);
      toast.error(t.transfers.actionFailed);
    }
  }

  /* ── start transfer handler ─────────────────────────────────── */
  async function handleStart() {
    if (!agreementId.trim()) {
      toast.warning(t.transfers.agreementRequired);
      return;
    }
    if (!counterPartyAddress.trim()) {
      toast.warning(t.transfers.counterPartyAddressRequired ?? "Provider DSP endpoint is required");
      return;
    }
    const isProxy = sinkType === "HttpProxy";
    if (!isProxy && !sinkEndpoint.trim()) {
      toast.warning(t.transfers.endpointRequired);
      return;
    }
    if (!connectorId) return;
    setSubmitting(true);
    try {
      await startTransfer(
        {
          agreementId,
          counterPartyAddress,
          assetId: assetId || undefined,
          dataSink: { type: sinkType, endpoint: sinkEndpoint },
        },
        connectorId
      );
      toast.success(t.transfers.started);
      queryClient.invalidateQueries({ queryKey: ["transfers", connectorId] });
      setAgreementId("");
      setAssetId("");
      setSinkEndpoint("");
      setCounterPartyAddress("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t.transfers.startFailed;
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {dataViewer && (
        <DataViewer
          tpId={dataViewer.tpId}
          asset={dataViewer.asset}
          data={dataViewer.data}
          sizeBytes={dataViewer.sizeBytes}
          contentType={dataViewer.contentType}
          onClose={() => setDataViewer(null)}
        />
      )}
      <SectionHdr breadcrumb={connector ? `${connector.name} / ${connector.bpn}` : undefined}>{t.transfers.title}</SectionHdr>

      {/* ── KPI Row ───────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label={t.transfers.completed}
          value={completedCount}
          colorClass="text-emerald-600"
          icon={<ArrowRightLeft className="w-4 h-4 text-emerald-600" />}
          iconBg="bg-emerald-50"
        />
        <KpiCard
          label={t.transfers.inflight}
          value={inflightCount}
          colorClass="text-blue-600"
          icon={<Send className="w-4 h-4 text-blue-600" />}
          iconBg="bg-blue-50"
        />
        <KpiCard
          label={t.transfers.totalVolume}
          value={`${totalVolume.toFixed(1)} MB`}
          icon={<HardDrive className="w-4 h-4 text-violet-600" />}
          iconBg="bg-violet-50"
        />
        <KpiCard
          label={t.transfers.avgDuration}
          value={avgDuration === "—" ? "—" : `${avgDuration}s`}
          icon={<Clock className="w-4 h-4 text-amber-600" />}
          iconBg="bg-amber-50"
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
        {/* ── Transfer List (2-col span) ──────────────────────── */}
        <Card
          className="xl:col-span-2"
          title={t.transfers.listTitle}
          actions={
            transfers.length > 0 ? (
              <RoleGate permission="transaction:write">
                <button
                  onClick={handleDeleteAll}
                  className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded font-medium text-red-500 hover:bg-red-50 border border-red-200 transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                  {t.transfers.deleteAll}
                </button>
              </RoleGate>
            ) : undefined
          }
        >
          {/* ── Filter Bar ────────────────────────────────────── */}
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <Filter className="w-3 h-3 text-muted-foreground flex-shrink-0" />
            {ALL_STATE_FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => { setStateFilter(f); setPage(1); }}
                className={`text-[11px] px-2 py-1 rounded-full border transition-colors ${
                  stateFilter === f
                    ? "bg-primary text-primary-foreground border-primary font-medium"
                    : "border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                {f === "ALL" ? t.transfers.filterAll : t.transfers.states[f as keyof typeof t.transfers.states] ?? f}
              </button>
            ))}
            <span className="text-[11px] text-muted-foreground ml-auto">
              {t.transfers.resultCount(rows.length, transfers.length)}
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

          {/* ── Desktop table ─────────────────────────────────── */}
          <div className="hidden md:block overflow-x-auto rounded-lg border border-border">
            <table className="w-full">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  {[t.transfers.col.id, t.transfers.col.state, t.transfers.col.assetId, t.transfers.col.type, t.transfers.col.size, t.transfers.col.duration, t.transfers.col.startedAt, t.transfers.col.completedAt, ""].map(
                    (h, idx) => (
                      <th
                        key={idx}
                        className="text-left !text-[12px] px-4 py-3 whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {paginate(rows, page, pageSize).map((tr) => (
                  <tr key={tr.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <MonoText className="!text-[12px] !font-normal">{tr.id.slice(0, 12)}</MonoText>
                    </td>
                    <td className="px-4 py-3">
                      <StateBadge name={tr.name} />
                    </td>
                    <td className="px-4 py-3">
                      <MonoText className="!text-[12px] !font-normal">{tr.asset}</MonoText>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={tr.transferType === "PULL" ? "sky" : tr.transferType === "PUSH" ? "purple" : "gray"}>{tr.transferType ?? "—"}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <span className="!text-[12px] font-normal text-muted-foreground">{tr.size}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="!text-[12px] font-normal text-muted-foreground">{tr.t}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="!text-[12px] font-normal text-muted-foreground">{tr.startedAt ?? "—"}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="!text-[12px] font-normal text-muted-foreground">{tr.completedAt ?? "—"}</span>
                    </td>
                    {/* 액션: STARTED → Fetch·완료·종료 */}
                    <td className="px-4 py-3">
                      {tr.name === "STARTED" && (
                        <div className="flex gap-1">
                          <button
                            onClick={() => handleFetch(tr.id, tr.asset)}
                            title={t.transfers.fetchData}
                            className="p-1 rounded hover:bg-blue-100 text-blue-500 transition-colors"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>
                          <RoleGate permission="transaction:write">
                            <button
                              onClick={() => handleComplete(tr.id)}
                              title={t.transfers.completeTransfer}
                              className="p-1 rounded hover:bg-emerald-100 text-emerald-600 transition-colors"
                            >
                              <CheckCircle className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleTerminate(tr.id)}
                              title={t.transfers.terminateTransfer}
                              className="p-1 rounded hover:bg-red-100 text-red-500 transition-colors"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                            </button>
                          </RoleGate>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 && (
              <div className="text-center py-6 text-[12px] text-muted-foreground">
                {stateFilter !== "ALL" ? t.transfers.noFilterResults : t.transfers.noInflight}
              </div>
            )}
            <Pagination total={rows.length} page={page} pageSize={pageSize} onPageChange={setPage} />
          </div>

          {/* ── Mobile card stack ─────────────────────────────── */}
          <div className="md:hidden space-y-3">
            {paginate(rows, page, pageSize).map((tr) => (
              <div
                key={tr.id}
                className="rounded-lg border border-border p-4 bg-muted/20 space-y-1.5"
              >
                <div className="flex items-center justify-between">
                  <MonoText className="text-[11px]">{tr.id.slice(0, 12)}</MonoText>
                  <div className="flex items-center gap-2">
                    <StateBadge name={tr.name} />
                    {tr.name === "STARTED" && (
                      <div className="flex gap-1">
                        <button onClick={() => handleFetch(tr.id, tr.asset)} title={t.transfers.fetchData}
                          className="p-1 rounded hover:bg-blue-100 text-blue-500"><Download className="w-3.5 h-3.5" /></button>
                        <RoleGate permission="transaction:write">
                          <button onClick={() => handleComplete(tr.id)} title={t.transfers.completeTransfer}
                            className="p-1 rounded hover:bg-emerald-100 text-emerald-600"><CheckCircle className="w-3.5 h-3.5" /></button>
                          <button onClick={() => handleTerminate(tr.id)} title={t.transfers.terminateTransfer}
                            className="p-1 rounded hover:bg-red-100 text-red-500"><XCircle className="w-3.5 h-3.5" /></button>
                        </RoleGate>
                      </div>
                    )}
                  </div>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  <span className="font-medium text-foreground/70">{t.transfers.col.assetId}:</span>{" "}
                  {tr.asset}
                </div>
                <div className="flex gap-3 text-[11px] text-muted-foreground">
                  <span>{tr.size}</span>
                  <span>{tr.t}</span>
                  <span>{tr.ts}</span>
                </div>
              </div>
            ))}
            {rows.length === 0 && (
              <div className="text-center py-6 text-[12px] text-muted-foreground">
                {stateFilter !== "ALL" ? t.transfers.noFilterResults : t.transfers.noInflight}
              </div>
            )}
          </div>
        </Card>

        {/* ── DataSink Start Form ─────────────────────────────── */}
        <Card title={t.transfers.dataSink}>
          <div className="space-y-3">
            <FormField label={t.transfers.agreementId} required>
              <input
                type="text"
                value={agreementId}
                onChange={(e) => setAgreementId(e.target.value)}
                placeholder="contract-agreement-id"
                className={INPUT_CLS}
              />
            </FormField>

            <FormField label={t.transfers.counterPartyAddress ?? "Provider DSP Endpoint"} required>
              <input
                type="text"
                value={counterPartyAddress}
                onChange={(e) => setCounterPartyAddress(e.target.value)}
                placeholder="http://controlplane:8283/api/v1/dsp/2025-1"
                className={INPUT_CLS}
              />
            </FormField>

            <FormField label={t.transfers.assetId}>
              <input
                type="text"
                value={assetId}
                onChange={(e) => setAssetId(e.target.value)}
                placeholder="asset-id"
                className={INPUT_CLS}
              />
            </FormField>

            <FormField label={t.transfers.sinkType} required>
              <select
                value={sinkType}
                onChange={(e) => setSinkType(e.target.value)}
                className={INPUT_CLS}
              >
                {SINK_TYPES.map((st) => (
                  <option key={st} value={st}>{st}</option>
                ))}
              </select>
            </FormField>

            {sinkType !== "HttpProxy" && (
              <FormField label={t.transfers.endpointUrl} required>
                <input
                  type="url"
                  value={sinkEndpoint}
                  onChange={(e) => setSinkEndpoint(e.target.value)}
                  placeholder="https://sink.example.com/receive"
                  className={INPUT_CLS}
                />
              </FormField>
            )}

            <RoleGate permission="transaction:write">
              <button
                onClick={handleStart}
                disabled={submitting}
                className="w-full text-[12px] font-medium py-2 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5"
              >
                <Send className="w-3 h-3" />
                {submitting ? `${t.transfers.startTransfer}...` : t.transfers.startTransfer}
              </button>
            </RoleGate>

            <SectionHdr>{t.transfers.fsmCodes}</SectionHdr>
            <div className="space-y-0">
              {Object.entries(TRANSFER_STATE_MAP).map(([code, info], i, arr) => (
                <div
                  key={code}
                  className={`flex items-center gap-3 py-1.5 ${
                    i < arr.length - 1 ? "border-b border-border" : ""
                  }`}
                >
                  <span className="mono text-[11px] text-muted-foreground w-10 flex-shrink-0">
                    {code}
                  </span>
                  <span className="w-28 flex-shrink-0"><StateBadge name={info.name} /></span>
                  <span className="text-[11px] text-muted-foreground">
                    {info.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
