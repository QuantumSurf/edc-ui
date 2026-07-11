// Connector Hub — Data Transfer Page (spec 4.6)
// TanStack Query polling, FSM badges, unified list, DataSink start form, KPI cards

import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearch } from "wouter";
import { useI18n } from "@/i18n";
import {
  fetchTransfers,
  startTransfer,
  completeTransfer,
  terminateTransfer,
  fetchTransferData,
  deleteAllTransfers,
  fetchEDRs,
} from "@/services";
import { SINK_TYPES, type Transfer, isTransferActive } from "@/lib/data";
import { useConnectorStore } from "@/stores/connectorStore";
import {
  DataTablePagination,
  usePagination,
} from "@/components/DataTablePagination";
import {
  Card,
  StateBadge,
  SectionHdr,
  Badge,
  FormField,
  ListCard,
  ListHeaderRow,
  ListRow,
  ListColLabel,
  ListEmpty,
  ListError,
  JsonTreeView,
  inputBase,
  RefreshButton,
} from "@/components/ui-kmx";

// 자산ID는 내용폭(고정 200px)으로 고정해 유형과 붙이고, 남는 여백은 시각 컬럼(flex)이 흡수.
// (과거 자산ID가 유일 1.4fr라 모든 여백을 흡수 → 자산ID와 유형 사이 간격이 과도하게 벌어짐)
// 반응형: lg 미만은 중요 컬럼(상태·자산ID·유형·완료시각[액션])만 유동폭으로 표시하고
// 부차 컬럼(전송ID·크기·소요시간·전송시각)은 hidden lg:block 으로 숨긴다. lg+ 는 전체 8컬럼.
const TRANSFER_COLS =
  "grid-cols-[96px_minmax(110px,1.3fr)_64px_minmax(150px,1.5fr)] lg:grid-cols-[110px_100px_200px_70px_72px_64px_minmax(130px,1fr)_minmax(130px,1fr)]";
import {
  SlidePanel,
  ConfirmActionDialog,
  InfoCard,
} from "@/components/DetailDeleteDialogs";
import { toast } from "sonner";
import {
  Send,
  CheckCircle,
  XCircle,
  Download,
  Trash2,
  FileText,
  AlertTriangle,
  X,
  Copy,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { RoleGate } from "@/components/RoleGate";
import {
  useFieldHistory,
  fhId,
  HistoryDatalist,
} from "@/components/FieldHistory";

/* ── helpers ──────────────────────────────────────────────────── */
const INPUT_CLS = inputBase;

const ALL_STATE_FILTERS = [
  "ALL",
  "REQUESTING",
  "STARTED",
  "SUSPENDED",
  "COMPLETED",
  "TERMINATED",
] as const;
type StateFilter = (typeof ALL_STATE_FILTERS)[number];

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

function DataViewer({
  tpId,
  asset,
  path,
  data,
  sizeBytes,
  contentType,
  onRequery,
  onClose,
}: DataViewerProps) {
  const { t } = useI18n();
  // 프록시 자산(DTR 등)은 하위 경로로 조회 — 경로 바를 통해 다른 경로 재조회 가능.
  const isProxyAsset = asset.startsWith("dtr-") || !!path;
  const [pathInput, setPathInput] = useState(path);
  useEffect(() => setPathInput(path), [path]);
  const isJson =
    contentType.includes("json") || (typeof data === "object" && data !== null);
  const formatted = isJson ? JSON.stringify(data, null, 2) : String(data);

  const sizeLabel =
    sizeBytes >= 1024 * 1024
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
      <div className="flex items-center justify-between gap-2 px-4 py-3 pr-10 border-b border-border bg-muted/30 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="w-4 h-4 text-primary flex-shrink-0" />
          <p className="text-[15px] font-semibold text-foreground truncate">
            {t.transfers.dataViewerTitle}
          </p>
          <span className="text-[11px] text-muted-foreground font-mono truncate">
            {tpId.slice(0, 12)}
          </span>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
            {sizeLabel}
          </span>
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground hidden sm:inline">
            {contentType.split(";")[0]}
          </span>
          <button
            onClick={handleDownload}
            title={t.transfers.saveAsFile}
            className="p-1 rounded hover:bg-muted text-muted-foreground transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Asset subtitle */}
      <div className="px-4 py-1.5 border-b border-border text-[11px] text-muted-foreground font-mono truncate flex-shrink-0">
        {asset}
      </div>

      {/* Proxy path bar (DTR 등 프록시 자산) */}
      {isProxyAsset && (
        <div className="px-4 py-2 border-b border-border bg-muted/20 flex items-center gap-2 flex-shrink-0">
          <span className="text-[11px] text-muted-foreground flex-shrink-0">
            {t.transfers.proxyPath}
          </span>
          <input
            className="flex-1 min-w-0 mono text-[12px] px-2 py-1 border border-border rounded bg-card text-foreground placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="/shell-descriptors"
            value={pathInput}
            onChange={e => setPathInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") onRequery(pathInput);
            }}
          />
          <RoleGate permission="transaction:write">
            <button
              onClick={() => onRequery(pathInput)}
              className="text-[12px] px-2.5 py-1 rounded bg-primary hover:bg-primary/90 text-primary-foreground font-medium flex-shrink-0"
            >
              {t.transfers.queryPath}
            </button>
          </RoleGate>
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
  const [agreementId, setAgreementId] = useState(
    () => qParams.get("agreementId") ?? ""
  );
  const [assetId, setAssetId] = useState(() => qParams.get("assetId") ?? "");
  const [counterPartyAddress, setCounterPartyAddress] = useState(
    () => qParams.get("cpa") ?? ""
  );
  // 입력 이력 기반 자동완성(계약 ID·Provider DSP·자산 ID·Sink endpoint).
  const { suggestions, record } = useFieldHistory([
    "transfer.agreementId",
    "transfer.counterPartyAddress",
    "transfer.assetId",
    "transfer.dataSink.endpoint",
  ]);

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
  const [detailTarget, setDetailTarget] = useState<Transfer | null>(null);
  const [dataViewer, setDataViewer] = useState<{
    tpId: string;
    asset: string;
    path: string;
    data: unknown;
    sizeBytes: number;
    contentType: string;
  } | null>(null);

  // Track IDs we already toasted so we don't re-fire
  const toastedRef = useRef<Set<string>>(new Set());
  // Track IDs that were user-initiated (complete/terminate button) — suppress TERMINATED toast
  const userActionRef = useRef<Set<string>>(new Set());

  const connector = useConnectorStore(s => s.connector);
  const connectorId = connector?.id;
  const queryClient = useQueryClient();

  // 첫 로드 여부 추적 — 초기 스냅샷의 TERMINATED는 toast 제외
  const initializedRef = useRef(false);

  /* ── query with conditional polling ─────────────────────────── */
  const {
    data: transfers = [],
    isError,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["transfers", connectorId],
    queryFn: () => fetchTransfers(connectorId!),
    enabled: !!connectorId,
    refetchInterval: query => {
      const list = query.state.data as Transfer[] | undefined;
      // 진행중(REQUESTING/STARTED)만 빠른 폴링. SUSPENDED는 사용자 개입 전 자동
      // 재개되지 않으므로 활성에서 제외해 무한 폴링을 종단한다.
      const hasInflight = list?.some(tr => isTransferActive(tr.state));
      // 진행중이면 3초, 유휴여도 5초 폴링 — 다른 세션/프로세스가 새로 만든 전송도 새로고침 없이 반영.
      return hasInflight ? 3000 : 5000;
    },
  });

  // 활성 EDR 집합(tpId 12자 prefix). STARTED인데 EDR이 없으면 데이터플레인 미가용/대기 신호.
  const { data: edrs = [] } = useQuery({
    queryKey: ["edrs", connectorId],
    queryFn: () => fetchEDRs(connectorId!),
    enabled: !!connectorId,
    // transfers 폴링과 동일하게 진행중(REQUESTING/STARTED)일 때만 자주 갱신.
    // SUSPENDED 잔존 시 무한 폴링을 막기 위해 transfers와 동일 헬퍼 사용.
    refetchInterval: transfers.some(tr => isTransferActive(tr.state))
      ? 3000
      : false,
  });
  const activeEdrTps = useMemo(
    () => new Set(edrs.filter(e => e.left !== 0).map(e => e.tpId)),
    [edrs]
  );
  // STARTED인데 (아직 데이터 미수신: size "—") + 활성 EDR 없음 → 데이터플레인 미가용/EDR 대기.
  // 이미 fetch해 size가 기록된 전송은 EDR이 만료돼도 정상이므로 힌트 제외(오탐 방지).
  const startedNoEdr = (tr: Transfer) =>
    tr.name === "STARTED" &&
    tr.size === "—" &&
    !activeEdrTps.has(tr.id.slice(0, 12));

  // 커넥터 전환 시 추적 ref를 재시딩한다. 그러지 않으면 새 커넥터의 transfers가
  // 도착할 때 초기 스냅샷 분기를 건너뛰어(initializedRef가 이미 true), 그 커넥터에
  // 이미 존재하던 과거 TERMINATED 전송들이 일제히 거짓 실패 토스트로 쏟아진다.
  useEffect(() => {
    initializedRef.current = false;
    toastedRef.current = new Set();
    userActionRef.current = new Set();
  }, [connectorId]);

  /* ── toast on TERMINATED (신규 실패만, 기존 상태 제외) ─────── */
  useEffect(() => {
    if (transfers.length === 0) return;

    if (!initializedRef.current) {
      // 첫 로드: 이미 TERMINATED/완료된 항목을 toastedRef에 등록 → toast 억제
      transfers.forEach(tr => {
        if (tr.state >= 1200) toastedRef.current.add(tr.id);
      });
      initializedRef.current = true;
      return;
    }

    // 이후 폴링: 새로 TERMINATED된 항목만 toast
    transfers.forEach(tr => {
      if (tr.state === 1300 && !toastedRef.current.has(tr.id)) {
        toastedRef.current.add(tr.id);
        if (!userActionRef.current.has(tr.id)) {
          toast.error(
            t.transfers.transferFailedToast(tr.id.slice(0, 12), tr.asset),
            {
              description: tr.errorDetail || undefined,
            }
          );
        }
      }
    });
  }, [transfers]);

  const rows = useMemo(() => {
    const filtered =
      stateFilter === "ALL"
        ? transfers
        : transfers.filter(tr => tr.name === stateFilter);
    // 최신순 정렬 — 시작시각(startedAt) 우선, 없으면 상태시각(ts)로 폴백.
    // (provider 전송은 UI가 시작한 게 아니라 startedAt이 "—"이므로, startedAt만으로 정렬하면
    //  정렬이 무력화돼 EDC 원본 순서가 나온다. 항상 채워지는 ts를 폴백으로 써 최신순 보장.)
    const key = (tr: Transfer) =>
      tr.startedAt && tr.startedAt !== "—" ? tr.startedAt : (tr.ts ?? "");
    return [...filtered].sort((a, b) => {
      const ta = key(a);
      const tb = key(b);
      if (!ta && !tb) return 0;
      if (!ta) return 1;
      if (!tb) return -1;
      return tb.localeCompare(ta);
    });
  }, [transfers, stateFilter]);

  const {
    paginatedData,
    totalItems,
    currentPage,
    pageSize,
    setCurrentPage,
    setPageSize,
  } = usePagination(rows, 10);

  // 상세 패널은 폴링으로 갱신되는 최신 transfers에서 id로 재조회 — 스냅샷 stale 방지.
  // 목록에서 사라진 항목(예: 전체 삭제)이면 null로 패널을 닫는다.
  const liveDetailTarget = useMemo(
    () =>
      detailTarget
        ? (transfers.find(tr => tr.id === detailTarget.id) ?? null)
        : null,
    [transfers, detailTarget]
  );

  // 파괴적 액션 확인 모달 상태 (네이티브 window.confirm 대체 — 일관된 모달/강조색/취소)
  const [confirmState, setConfirmState] = useState<{
    title: string;
    description: string;
    tone: "warn" | "danger";
    confirmLabel: string;
    onConfirm: () => void;
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
          // 전송 상태 변화는 데이터플레인 EDR 발급/만료의 트리거이므로 EDR·통계도 함께 무효화.
          queryClient.invalidateQueries({
            queryKey: ["transfers", connectorId],
          });
          queryClient.invalidateQueries({ queryKey: ["edrs", connectorId] });
          queryClient.invalidateQueries({
            queryKey: ["edr-stats", connectorId],
          });
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
          queryClient.invalidateQueries({
            queryKey: ["transfers", connectorId],
          });
        } catch {
          toast.error(t.transfers.actionFailed);
        }
      },
    });
  }

  async function handleFetch(tpId: string, asset: string, path?: string) {
    if (!connectorId) return;
    // 프록시 자산(DTR)은 루트 pull이 비므로 하위 경로로 조회 — 기본 /shell-descriptors.
    const effectivePath =
      path !== undefined
        ? path
        : asset.startsWith("dtr-")
          ? "/shell-descriptors"
          : "";
    try {
      const result = await fetchTransferData(
        tpId,
        connectorId,
        effectivePath || undefined
      );
      // 데이터 뷰어 표시 — 상세 패널과 같은 z-50 이라 상세가 열려 있으면 뷰어를 덮어버린다
      // (상세가 DOM에서 나중 렌더). 뷰어를 열 때 상세 패널을 닫아 바로 보이게 한다.
      setDetailTarget(null);
      setDataViewer({
        tpId,
        asset,
        path: effectivePath,
        data: result.data,
        sizeBytes: result.sizeBytes,
        contentType: result.contentType,
      });
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
          queryClient.invalidateQueries({
            queryKey: ["transfers", connectorId],
          });
          queryClient.invalidateQueries({ queryKey: ["edrs", connectorId] });
          queryClient.invalidateQueries({
            queryKey: ["edr-stats", connectorId],
          });
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
      toast.warning(
        t.transfers.counterPartyAddressRequired ??
          "Provider DSP endpoint is required"
      );
      return;
    }
    // 형식 보강: Provider DSP 엔드포인트는 http(s):// URL 이어야 한다.
    if (!/^https?:\/\//i.test(counterPartyAddress.trim())) {
      toast.warning(t.transfers.counterPartyAddressInvalidScheme);
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
      // 입력값을 서버 이력에 기록(다음 작성 시 자동완성). record() 가 빈값은 무시.
      record([
        { fieldKey: "transfer.agreementId", value: agreementId },
        {
          fieldKey: "transfer.counterPartyAddress",
          value: counterPartyAddress,
        },
        { fieldKey: "transfer.assetId", value: assetId },
        ...(sinkType !== "HttpProxy"
          ? [{ fieldKey: "transfer.dataSink.endpoint", value: sinkEndpoint }]
          : []),
      ]);
      // 전송 시작은 EDR 발급 트리거 — EDR 목록·통계도 무효화해 교차 페이지 stale 방지.
      queryClient.invalidateQueries({ queryKey: ["transfers", connectorId] });
      queryClient.invalidateQueries({ queryKey: ["edrs", connectorId] });
      queryClient.invalidateQueries({ queryKey: ["edr-stats", connectorId] });
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
          onRequery={p => handleFetch(dataViewer.tpId, dataViewer.asset, p)}
          onClose={() => setDataViewer(null)}
        />
      )}

      {liveDetailTarget && (
        <TransferDetailSheet
          target={liveDetailTarget}
          startedNoEdr={startedNoEdr(liveDetailTarget)}
          onClose={() => setDetailTarget(null)}
          onFetch={() =>
            handleFetch(liveDetailTarget.id, liveDetailTarget.asset)
          }
          onComplete={() => handleComplete(liveDetailTarget.id)}
          onTerminate={() => handleTerminate(liveDetailTarget.id)}
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
          onConfirm={() => {
            const fn = confirmState.onConfirm;
            setConfirmState(null);
            fn();
          }}
        />
      )}
      <SectionHdr
        icon={<Send className="w-5 h-5 text-primary" />}
        subtitle={t.pageSubtitles.transfers}
        action={
          <RefreshButton
            onRefresh={() => refetch()}
            busy={isFetching}
            label={t.common.refresh}
          />
        }
      >
        {t.transfers.title}
      </SectionHdr>

      {/* ── Filter — 상태 칩을 카드에 그룹화 (목록 페이지 검색/필터 카드와 통일) ── */}
      <div className="flex flex-wrap items-center gap-1.5 bg-card border border-border rounded-xl px-4 py-3 shadow-sm">
        {ALL_STATE_FILTERS.map(f => (
          <button
            key={f}
            onClick={() => {
              setStateFilter(f);
              setCurrentPage(1);
            }}
            className={`px-3 py-1.5 rounded-full text-[11px] font-medium transition-all duration-150 border ${
              stateFilter === f
                ? "bg-primary text-primary-foreground border-primary shadow-sm"
                : "bg-background border-border text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            {f === "ALL"
              ? t.transfers.filterAll
              : (t.transfers.states[f as keyof typeof t.transfers.states] ?? f)}
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
            responsive
            actions={
              transfers.length > 0 ? (
                <RoleGate permission="transaction:write">
                  <button
                    onClick={handleDeleteAll}
                    className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 border border-red-200 dark:border-red-500/30 transition-colors"
                  >
                    <Trash2 className="w-3 h-3" />
                    {t.transfers.deleteAll}
                  </button>
                </RoleGate>
              ) : undefined
            }
          >
            <ListHeaderRow cols={TRANSFER_COLS}>
              {/* lg 미만은 중요 컬럼(상태·자산ID·유형·완료시각)만 — 부차 컬럼은 hidden lg:block */}
              <ListColLabel className="hidden lg:block">
                {t.transfers.col.id}
              </ListColLabel>
              <ListColLabel>{t.transfers.col.state}</ListColLabel>
              <ListColLabel>{t.transfers.col.assetId}</ListColLabel>
              <ListColLabel>{t.transfers.col.type}</ListColLabel>
              <ListColLabel className="hidden lg:block">
                {t.transfers.col.size}
              </ListColLabel>
              <ListColLabel className="hidden lg:block">
                {t.transfers.col.duration}
              </ListColLabel>
              <ListColLabel className="hidden lg:block">
                {t.transfers.col.startedAt}
              </ListColLabel>
              <ListColLabel>{t.transfers.col.completedAt}</ListColLabel>
            </ListHeaderRow>
            {isError && rows.length === 0 ? (
              <ListError onRetry={() => refetch()} fetching={isFetching} />
            ) : rows.length === 0 ? (
              <ListEmpty
                icon={<Send />}
                message={
                  stateFilter !== "ALL"
                    ? t.transfers.noFilterResults
                    : t.transfers.noTransfers
                }
              />
            ) : (
              paginatedData.map(tr => (
                <ListRow
                  key={tr.id}
                  cols={TRANSFER_COLS}
                  selected={detailTarget?.id === tr.id}
                  onClick={() => setDetailTarget(tr)}
                >
                  <div className="hidden lg:block">
                    <span className="text-xs font-bold text-primary">
                      {tr.id.slice(0, 12)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <StateBadge
                      name={tr.name}
                      label={
                        (t.transfers.states as Record<string, string>)[
                          tr.name
                        ] ?? tr.name
                      }
                    />
                    {startedNoEdr(tr) && (
                      <span
                        title={t.transfers.edrPendingHint}
                        className="inline-flex items-center text-amber-600 dark:text-amber-400"
                      >
                        <AlertTriangle className="w-3 h-3" />
                      </span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <span className="text-xs text-foreground block truncate">
                      {tr.asset}
                    </span>
                  </div>
                  <div>
                    <Badge
                      variant={
                        tr.transferType === "PULL"
                          ? "sky"
                          : tr.transferType === "PUSH"
                            ? "purple"
                            : "gray"
                      }
                    >
                      {tr.transferType ?? "—"}
                    </Badge>
                  </div>
                  <div className="hidden lg:block text-xs text-foreground">
                    {tr.size}
                  </div>
                  <div className="hidden lg:block text-xs text-foreground">
                    {tr.t}
                  </div>
                  <div className="hidden lg:block text-xs text-foreground truncate">
                    {tr.startedAt ?? "—"}
                  </div>
                  <div className="text-xs text-foreground">
                    {tr.name === "STARTED" ? (
                      // 진행 중 행은 완료 시각이 아직 없으므로(—) 그 자리에 동작 버튼을 인라인 표시.
                      // 버튼 클릭이 행 onClick(상세 패널 열기)으로 전파되지 않게 래퍼에서 차단.
                      <div
                        className="flex items-center gap-1 flex-wrap"
                        onClick={e => e.stopPropagation()}
                      >
                        <RoleGate permission="transaction:write">
                          <button
                            onClick={() => handleFetch(tr.id, tr.asset)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium text-blue-500 hover:bg-blue-100 dark:hover:bg-blue-500/15 transition-colors"
                          >
                            <Download className="w-3 h-3" />{" "}
                            {t.transfers.fetchData}
                          </button>
                          <button
                            onClick={() => handleComplete(tr.id)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-500/15 transition-colors"
                          >
                            <CheckCircle className="w-3 h-3" />{" "}
                            {t.transfers.completeTransfer}
                          </button>
                          <button
                            onClick={() => handleTerminate(tr.id)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium text-red-500 hover:bg-red-100 dark:hover:bg-red-500/15 transition-colors"
                          >
                            <XCircle className="w-3 h-3" />{" "}
                            {t.transfers.terminateTransfer}
                          </button>
                        </RoleGate>
                      </div>
                    ) : (
                      <span className="truncate">{tr.completedAt ?? "—"}</span>
                    )}
                  </div>
                </ListRow>
              ))
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
          </ListCard>

          {/* ── Mobile card stack ─────────────────────────────── */}
          <div className="md:hidden space-y-3">
            {paginatedData.map(tr => (
              <div
                key={tr.id}
                className="rounded-lg border border-border p-4 bg-muted/20 space-y-1.5 cursor-pointer"
                onClick={() => setDetailTarget(tr)}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-primary">
                    {tr.id.slice(0, 12)}
                  </span>
                  <div className="flex items-center gap-2">
                    <StateBadge
                      name={tr.name}
                      label={
                        (t.transfers.states as Record<string, string>)[
                          tr.name
                        ] ?? tr.name
                      }
                    />
                    {startedNoEdr(tr) && (
                      <span
                        title={t.transfers.edrPendingHint}
                        className="inline-flex items-center text-amber-600 dark:text-amber-400"
                      >
                        <AlertTriangle className="w-3 h-3" />
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
                  <span className="font-medium text-foreground/70">
                    {t.transfers.col.assetId}:
                  </span>
                  <span className="text-xs text-foreground break-all">
                    {tr.asset}
                  </span>
                  {tr.transferType && tr.transferType !== "—" && (
                    <Badge
                      variant={
                        tr.transferType === "PULL"
                          ? "sky"
                          : tr.transferType === "PUSH"
                            ? "purple"
                            : "gray"
                      }
                    >
                      {tr.transferType}
                    </Badge>
                  )}
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                  <span>
                    {t.transfers.col.size}:{" "}
                    <span className="text-foreground">{tr.size}</span>
                  </span>
                  <span>
                    {t.transfers.col.duration}:{" "}
                    <span className="text-foreground">{tr.t}</span>
                  </span>
                  <span>
                    {t.transfers.col.startedAt}:{" "}
                    <span className="text-foreground">
                      {tr.startedAt ?? "—"}
                    </span>
                  </span>
                </div>
              </div>
            ))}
            {rows.length === 0 && (
              <ListEmpty
                icon={<Send />}
                message={
                  stateFilter !== "ALL"
                    ? t.transfers.noFilterResults
                    : t.transfers.noTransfers
                }
              />
            )}
            {/* 모바일도 페이지네이션 노출 — 없으면 최신 10건 이후 전송에 접근 불가(데스크톱과 동일 상태 공유) */}
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

        {/* ── DataSink Start Form ─────────────────────────────── */}
        <Card title={t.transfers.dataSink}>
          <div className="space-y-3">
            <FormField label={t.transfers.agreementId} required>
              <input
                type="text"
                value={agreementId}
                onChange={e => setAgreementId(e.target.value)}
                placeholder="contract-agreement-id"
                list={fhId("transfer.agreementId")}
                className={INPUT_CLS}
              />
              <HistoryDatalist
                id={fhId("transfer.agreementId")}
                options={suggestions["transfer.agreementId"]}
              />
            </FormField>

            <FormField
              label={t.transfers.counterPartyAddress ?? "Provider DSP Endpoint"}
              required
            >
              <input
                type="text"
                value={counterPartyAddress}
                onChange={e => setCounterPartyAddress(e.target.value)}
                placeholder="http://controlplane:8283/api/v1/dsp/2025-1"
                list={fhId("transfer.counterPartyAddress")}
                className={INPUT_CLS}
              />
              <HistoryDatalist
                id={fhId("transfer.counterPartyAddress")}
                options={suggestions["transfer.counterPartyAddress"]}
              />
            </FormField>

            <FormField label={t.transfers.assetId}>
              <input
                type="text"
                value={assetId}
                onChange={e => setAssetId(e.target.value)}
                placeholder="asset-id"
                list={fhId("transfer.assetId")}
                className={INPUT_CLS}
              />
              <HistoryDatalist
                id={fhId("transfer.assetId")}
                options={suggestions["transfer.assetId"]}
              />
            </FormField>

            <FormField label={t.transfers.sinkType} required>
              <select
                value={sinkType}
                onChange={e => setSinkType(e.target.value)}
                className={INPUT_CLS}
              >
                {SINK_TYPES.map(st => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
            </FormField>

            {sinkType !== "HttpProxy" && (
              <FormField label={t.transfers.endpointUrl} required>
                <input
                  type="url"
                  value={sinkEndpoint}
                  onChange={e => setSinkEndpoint(e.target.value)}
                  placeholder="https://sink.example.com/receive"
                  list={fhId("transfer.dataSink.endpoint")}
                  className={INPUT_CLS}
                />
                <HistoryDatalist
                  id={fhId("transfer.dataSink.endpoint")}
                  options={suggestions["transfer.dataSink.endpoint"]}
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
                {submitting
                  ? t.transfers.starting
                  : t.transfers.startTransfer}
              </button>
            </RoleGate>
          </div>
        </Card>
      </div>
    </>
  );
}

/* ── 전송 상세 패널 ───────────────────────────────────────────── */
// 목록의 액션(Fetch·완료·종료)을 이전한 상세 SlidePanel. 액션은 기존 STARTED 조건 유지.
function TransferDetailSheet({
  target,
  startedNoEdr,
  onClose,
  onFetch,
  onComplete,
  onTerminate,
}: {
  target: Transfer;
  startedNoEdr: boolean;
  onClose: () => void;
  onFetch: () => void;
  onComplete: () => void;
  onTerminate: () => void;
}) {
  const { t } = useI18n();
  const stateLabel =
    (t.transfers.states as Record<string, string>)[target.name] ?? target.name;
  return (
    <SlidePanel open={true} onClose={onClose} className="sm:max-w-2xl">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2 flex-wrap pr-8">
          <Send className="w-4 h-4 text-primary flex-shrink-0" />
          <h2 className="text-[15px] font-semibold text-foreground truncate">
            {t.transfers.title}
          </h2>
          <StateBadge name={target.name} label={stateLabel} />
          {startedNoEdr && (
            <span
              title={t.transfers.edrPendingHint}
              className="inline-flex items-center text-amber-600 dark:text-amber-400"
            >
              <AlertTriangle className="w-3.5 h-3.5" />
            </span>
          )}
        </div>
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
      <div className="flex-1 overflow-auto p-5 space-y-3 text-xs">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <InfoCard label={t.transfers.col.state} value={stateLabel} />
          <InfoCard
            label={t.transfers.col.type}
            value={target.transferType ?? "—"}
          />
          <InfoCard
            label={t.transfers.col.assetId}
            value={target.asset}
            span
            mono
            copyable={target.asset || undefined}
          />
          <InfoCard
            label={t.transfers.agreementId}
            value={target.agreementId}
            span
            mono
            copyable={target.agreementId || undefined}
          />
          <InfoCard label={t.transfers.col.size} value={target.size} />
          <InfoCard label={t.transfers.col.duration} value={target.t} />
          <InfoCard
            label={t.transfers.col.startedAt}
            value={target.startedAt}
          />
          <InfoCard
            label={t.transfers.col.completedAt}
            value={target.completedAt}
          />
          <InfoCard label={t.transfers.col.failedAt} value={target.failedAt} />
        </div>

        {target.errorDetail && (
          <div>
            <p className="text-[11px] font-bold text-rose-600 dark:text-rose-400 uppercase tracking-wide mb-2">
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

      {/* Footer — 목록에서 이전한 액션. STARTED일 때만 노출(기존 조건 유지). */}
      <div className="flex justify-end gap-2 px-5 py-4 bg-muted/30 border-t border-border flex-shrink-0">
        {target.name === "STARTED" && (
          <>
            <RoleGate permission="transaction:write">
              <button
                onClick={onFetch}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-500 hover:bg-blue-100 dark:hover:bg-blue-500/15 rounded-md transition-colors"
              >
                <Download size={13} /> {t.transfers.fetchData}
              </button>
              <button
                onClick={onComplete}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-500/15 rounded-md transition-colors"
              >
                <CheckCircle size={13} /> {t.transfers.completeTransfer}
              </button>
              <button
                onClick={onTerminate}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-500 hover:bg-red-100 dark:hover:bg-red-500/15 rounded-md transition-colors"
              >
                <XCircle size={13} /> {t.transfers.terminateTransfer}
              </button>
            </RoleGate>
          </>
        )}
        <button
          onClick={onClose}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium border border-border text-foreground rounded-md hover:bg-muted transition-colors"
        >
          <X size={13} /> {t.common.close}
        </button>
      </div>
    </SlidePanel>
  );
}
