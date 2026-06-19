// Connector Hub — Data Transfer Page (spec 4.6)
// TanStack Query polling, FSM badges, unified list, DataSink start form, KPI cards

import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearch } from "wouter";
import { useI18n } from "@/i18n";
import { fetchTransfers, startTransfer, completeTransfer, terminateTransfer, fetchTransferData, deleteAllTransfers, fetchEDRs } from "@/services";
import { SINK_TYPES, type Transfer } from "@/lib/data";
import { useConnectorStore } from "@/stores/connectorStore";
import { DataTablePagination, usePagination } from "@/components/DataTablePagination";
import {
  Card, StateBadge, SectionHdr, Badge, FormField,
  ListCard, ListHeaderRow, ListRow, ListColLabel, ListEmpty, ListError, JsonTreeView, inputBase,
} from "@/components/ui-kmx";

const TRANSFER_COLS = "grid-cols-[110px_100px_1.4fr_70px_72px_64px_110px_110px_280px]";
import { SlidePanel, ConfirmActionDialog } from "@/components/DetailDeleteDialogs";
import { toast } from "sonner";
import { Send, ArrowRightLeft, CheckCircle, XCircle, Download, Trash2, FileText, AlertTriangle, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { RoleGate } from "@/components/RoleGate";

/* ── helpers ──────────────────────────────────────────────────── */
const INPUT_CLS = inputBase;

const ALL_STATE_FILTERS = ["ALL", "REQUESTING", "STARTED", "SUSPENDED", "COMPLETED", "TERMINATED"] as const;
type StateFilter = typeof ALL_STATE_FILTERS[number];

/* ── 데이터 뷰어 모달 ─────────────────────────────────────────── */
interface DataViewerProps {
  tpId: string;
  asset: string;
  path: string;
  data: unknown;
  sizeBytes: number;
  contentType: string;
  onRequery: (path: string) => void;
  onClose: () => void;
}

function DataViewer({ tpId, asset, path, data, sizeBytes, contentType, onRequery, onClose }: DataViewerProps) {
  const { t } = useI18n();
  // 프록시 자산(DTR 등)은 하위 경로로 조회 — 경로 바를 통해 다른 경로 재조회 가능.
  const isProxyAsset = asset.startsWith("dtr-") || !!path;
  const [pathInput, setPathInput] = useState(path);
  useEffect(() => setPathInput(path), [path]);
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
    <SlidePanel open={true} onClose={onClose} className="max-w-2xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border bg-muted/30 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="w-4 h-4 text-primary flex-shrink-0" />
          <p className="text-[15px] font-semibold text-foreground truncate">{t.transfers.dataViewerTitle}</p>
          <span className="text-[11px] text-muted-foreground font-mono truncate">{tpId.slice(0, 12)}</span>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{sizeLabel}</span>
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground hidden sm:inline">{contentType.split(";")[0]}</span>
          <button
            onClick={handleDownload}
            title={t.transfers.saveAsFile}
            className="p-1 rounded hover:bg-muted text-muted-foreground transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onClose}
            aria-label={t.common.close}
            className="-mr-1 p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Asset subtitle */}
      <div className="px-4 py-1.5 border-b border-border text-[11px] text-muted-foreground font-mono truncate flex-shrink-0">{asset}</div>

      {/* Proxy path bar (DTR 등 프록시 자산) */}
      {isProxyAsset && (
        <div className="px-4 py-2 border-b border-border bg-muted/20 flex items-center gap-2 flex-shrink-0">
          <span className="text-[11px] text-muted-foreground flex-shrink-0">{t.transfers.proxyPath}</span>
          <input
            className="flex-1 min-w-0 mono text-[12px] px-2 py-1 border border-border rounded bg-card text-foreground placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="/shell-descriptors"
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") onRequery(pathInput); }}
          />
          <button
            onClick={() => onRequery(pathInput)}
            className="text-[12px] px-2.5 py-1 rounded bg-primary hover:bg-primary/90 text-primary-foreground font-medium flex-shrink-0"
          >
            {t.transfers.queryPath}
          </button>
        </div>
      )}

      {/* Body */}
      <div className="overflow-auto flex-1 p-4 min-h-0">
        {isJson ? (
          <JsonTreeView data={data} />
        ) : (
          <pre className="mono text-[12px] bg-muted text-foreground rounded-lg p-3 overflow-auto whitespace-pre-wrap leading-relaxed break-all border border-border">
            {formatted}
          </pre>
        )}
      </div>
    </SlidePanel>
  );
}

/* ── component ────────────────────────────────────────────────── */
export default function PageTransfer() {
  const { t } = useI18n();
  const search = useSearch();
  const qParams = useMemo(() => new URLSearchParams(search), [search]);

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
    tpId: string; asset: string; path: string; data: unknown; sizeBytes: number; contentType: string;
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
  const { data: transfers = [], isError, refetch, isFetching } = useQuery({
    queryKey: ["transfers", connectorId],
    queryFn: () => fetchTransfers(connectorId!),
    enabled: !!connectorId,
    refetchInterval: (query) => {
      const list = query.state.data as Transfer[] | undefined;
      const hasInflight = list?.some((tr) => tr.state < 1200);
      return hasInflight ? 3000 : false;
    },
  });

  // 활성 EDR 집합(tpId 12자 prefix). STARTED인데 EDR이 없으면 데이터플레인 미가용/대기 신호.
  const { data: edrs = [] } = useQuery({
    queryKey: ["edrs", connectorId],
    queryFn: () => fetchEDRs(connectorId!),
    enabled: !!connectorId,
    // transfers 폴링과 동일하게 inflight일 때만 자주 갱신
    refetchInterval: transfers.some((tr) => tr.state < 1200) ? 3000 : false,
  });
  const activeEdrTps = useMemo(
    () => new Set(edrs.filter((e) => e.left !== 0).map((e) => e.tpId)),
    [edrs],
  );
  // STARTED인데 (아직 데이터 미수신: size "—") + 활성 EDR 없음 → 데이터플레인 미가용/EDR 대기.
  // 이미 fetch해 size가 기록된 전송은 EDR이 만료돼도 정상이므로 힌트 제외(오탐 방지).
  const startedNoEdr = (tr: Transfer) =>
    tr.name === "STARTED" && tr.size === "—" && !activeEdrTps.has(tr.id.slice(0, 12));

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

  const { paginatedData, totalItems, currentPage, pageSize, setCurrentPage, setPageSize } = usePagination(rows, 10);

  // 파괴적 액션 확인 모달 상태 (네이티브 window.confirm 대체 — 일관된 모달/강조색/취소)
  const [confirmState, setConfirmState] = useState<{
    title: string; description: string; tone: "warn" | "danger"; confirmLabel: string; onConfirm: () => void;
  } | null>(null);

  /* ── complete / terminate handlers ─────────────────────────── */
  function handleComplete(tpId: string) {
    if (!connectorId) return;
    setConfirmState({
      title: t.transfers.completeTransfer,
      description: t.transfers.completeConfirm,
      tone: "warn",
      confirmLabel: t.common.confirm,
      onConfirm: async () => {
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
      },
    });
  }

  function handleDeleteAll() {
    if (!connectorId) return;
    setConfirmState({
      title: t.transfers.deleteAll,
      description: t.transfers.deleteAllConfirm,
      tone: "danger",
      confirmLabel: t.common.delete,
      onConfirm: async () => {
        try {
          const { deleted } = await deleteAllTransfers(connectorId);
          toast.success(t.transfers.deleteAllSuccess(deleted));
          queryClient.invalidateQueries({ queryKey: ["transfers", connectorId] });
        } catch {
          toast.error(t.transfers.actionFailed);
        }
      },
    });
  }

  async function handleFetch(tpId: string, asset: string, path?: string) {
    if (!connectorId) return;
    // 프록시 자산(DTR)은 루트 pull이 비므로 하위 경로로 조회 — 기본 /shell-descriptors.
    const effectivePath = path !== undefined ? path : (asset.startsWith("dtr-") ? "/shell-descriptors" : "");
    try {
      const result = await fetchTransferData(tpId, connectorId, effectivePath || undefined);
      // 모달 표시
      setDataViewer({ tpId, asset, path: effectivePath, data: result.data, sizeBytes: result.sizeBytes, contentType: result.contentType });
      queryClient.invalidateQueries({ queryKey: ["transfers", connectorId] });
    } catch {
      toast.error(t.transfers.fetchFailed);
    }
  }

  function handleTerminate(tpId: string) {
    if (!connectorId) return;
    setConfirmState({
      title: t.transfers.terminateTransfer,
      description: t.transfers.terminateConfirm,
      tone: "danger",
      confirmLabel: t.common.confirm,
      onConfirm: async () => {
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
      },
    });
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
          path={dataViewer.path}
          data={dataViewer.data}
          sizeBytes={dataViewer.sizeBytes}
          contentType={dataViewer.contentType}
          onRequery={(p) => handleFetch(dataViewer.tpId, dataViewer.asset, p)}
          onClose={() => setDataViewer(null)}
        />
      )}

      {/* 파괴적 액션 확인 모달 (완료/종료/전체삭제) */}
      {confirmState && (
        <ConfirmActionDialog
          open
          onClose={() => setConfirmState(null)}
          title={confirmState.title}
          description={confirmState.description}
          tone={confirmState.tone}
          confirmLabel={confirmState.confirmLabel}
          onConfirm={() => { const fn = confirmState.onConfirm; setConfirmState(null); fn(); }}
        />
      )}
      <SectionHdr icon={<ArrowRightLeft className="w-5 h-5 text-primary" />}>{t.transfers.title}</SectionHdr>


      {/* ── Filter — fl-aggregator TasksPage style ───────────── */}
      <div className="flex flex-wrap items-center gap-1.5">
        {ALL_STATE_FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => { setStateFilter(f); setCurrentPage(1); }}
            className={`px-3 py-1.5 rounded-full text-[11px] font-medium transition-all duration-150 border ${
              stateFilter === f
                ? "bg-primary text-primary-foreground border-primary shadow-sm"
                : "bg-card border-border text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            {f === "ALL" ? t.transfers.filterAll : t.transfers.states[f as keyof typeof t.transfers.states] ?? f}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {/* ── Transfer List ──────────────────────────────────── */}
        <div className="min-w-0">
          {/* Desktop: List — fl-aggregator ListCard */}
          <ListCard
            title={t.transfers.listTitle}
            className="hidden md:block"
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
            <ListHeaderRow cols={TRANSFER_COLS}>
              <ListColLabel>{t.transfers.col.id}</ListColLabel>
              <ListColLabel>{t.transfers.col.state}</ListColLabel>
              <ListColLabel>{t.transfers.col.assetId}</ListColLabel>
              <ListColLabel>{t.transfers.col.type}</ListColLabel>
              <ListColLabel>{t.transfers.col.size}</ListColLabel>
              <ListColLabel>{t.transfers.col.duration}</ListColLabel>
              <ListColLabel>{t.transfers.col.startedAt}</ListColLabel>
              <ListColLabel>{t.transfers.col.completedAt}</ListColLabel>
              <ListColLabel>{t.transfers.col.action}</ListColLabel>
            </ListHeaderRow>
            {isError && rows.length === 0 ? (
              <ListError onRetry={() => refetch()} fetching={isFetching} />
            ) : rows.length === 0 ? (
              <ListEmpty
                icon={<ArrowRightLeft />}
                message={stateFilter !== "ALL" ? t.transfers.noFilterResults : t.transfers.noInflight}
              />
            ) : (
              paginatedData.map((tr) => (
              <ListRow key={tr.id} cols={TRANSFER_COLS}>
                <div>
                  <span className="text-xs font-bold text-primary">{tr.id.slice(0, 12)}</span>
                </div>
                <div className="flex items-center gap-1">
                  <StateBadge name={tr.name} />
                  {startedNoEdr(tr) && (
                    <span title={t.transfers.edrPendingHint} className="inline-flex items-center text-amber-600">
                      <AlertTriangle className="w-3 h-3" />
                    </span>
                  )}
                </div>
                <div className="min-w-0">
                  <span className="text-xs text-foreground block truncate">{tr.asset}</span>
                </div>
                <div>
                  <Badge variant={tr.transferType === "PULL" ? "sky" : tr.transferType === "PUSH" ? "purple" : "gray"}>{tr.transferType ?? "—"}</Badge>
                </div>
                <div className="text-xs text-foreground">{tr.size}</div>
                <div className="text-xs text-foreground">{tr.t}</div>
                <div className="text-xs text-foreground truncate">{tr.startedAt ?? "—"}</div>
                <div className="text-xs text-foreground truncate">{tr.completedAt ?? "—"}</div>
                {/* 액션: STARTED → Fetch·완료·종료 */}
                <div>
                  {tr.name === "STARTED" && (
                    <div className="flex flex-wrap gap-1">
                      <button
                        onClick={() => handleFetch(tr.id, tr.asset)}
                        title={t.transfers.fetchData}
                        className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded hover:bg-blue-100 text-blue-500 font-medium transition-colors whitespace-nowrap"
                      >
                        <Download className="w-3.5 h-3.5" /> {t.transfers.fetchData}
                      </button>
                      <RoleGate permission="transaction:write">
                        <button
                          onClick={() => handleComplete(tr.id)}
                          title={t.transfers.completeTransfer}
                          className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded hover:bg-emerald-100 text-emerald-600 font-medium transition-colors whitespace-nowrap"
                        >
                          <CheckCircle className="w-3.5 h-3.5" /> {t.transfers.completeTransfer}
                        </button>
                        <button
                          onClick={() => handleTerminate(tr.id)}
                          title={t.transfers.terminateTransfer}
                          className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded hover:bg-red-100 text-red-500 font-medium transition-colors whitespace-nowrap"
                        >
                          <XCircle className="w-3.5 h-3.5" /> {t.transfers.terminateTransfer}
                        </button>
                      </RoleGate>
                    </div>
                  )}
                </div>
              </ListRow>
              )))}
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

          {/* ── Mobile card stack ─────────────────────────────── */}
          <div className="md:hidden space-y-3">
            {paginatedData.map((tr) => (
              <div
                key={tr.id}
                className="rounded-lg border border-border p-4 bg-muted/20 space-y-1.5"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-primary">{tr.id.slice(0, 12)}</span>
                  <div className="flex items-center gap-2">
                    <StateBadge name={tr.name} />
                    {startedNoEdr(tr) && (
                      <span title={t.transfers.edrPendingHint} className="inline-flex items-center text-amber-600">
                        <AlertTriangle className="w-3 h-3" />
                      </span>
                    )}
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
                <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
                  <span className="font-medium text-foreground/70">{t.transfers.col.assetId}:</span>
                  <span className="text-xs text-foreground break-all">{tr.asset}</span>
                  {tr.transferType && tr.transferType !== "—" && <Badge variant={tr.transferType === "PULL" ? "sky" : tr.transferType === "PUSH" ? "purple" : "gray"}>{tr.transferType}</Badge>}
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                  <span>{t.transfers.col.size}: <span className="text-foreground">{tr.size}</span></span>
                  <span>{t.transfers.col.duration}: <span className="text-foreground">{tr.t}</span></span>
                  <span>{t.transfers.col.startedAt}: <span className="text-foreground">{tr.startedAt ?? "—"}</span></span>
                </div>
              </div>
            ))}
            {rows.length === 0 && (
              <ListEmpty
                icon={<ArrowRightLeft />}
                message={stateFilter !== "ALL" ? t.transfers.noFilterResults : t.transfers.noInflight}
              />
            )}
          </div>
        </div>

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
          </div>
        </Card>
      </div>
    </>
  );
}
