// Connector Hub — EDR Token Management (spec 4.7)
// Expiry color coding, authCode masking with copy confirmation modal (NF-23)

import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { fetchEDRs, fetchEDRStats } from "@/services";
import { type EDR, type EDRStats } from "@/lib/data";
import { fmtNum } from "@/lib/format";
import { useConnectorStore } from "@/stores/connectorStore";
import {
  Card,
  Badge,
  AlertBanner,
  ProgressBar,
  SectionHdr,
  RefreshButton,
  CardTitle,
  ListCard,
  ListHeaderRow,
  ListRow,
  ListColLabel,
  ListEmpty,
  ListError,
} from "@/components/ui-kmx";

// 남은시간(우측정렬 텍스트)과 제공자/엔드포인트가 붙고 authCode 와 빈 공간이 크던 문제 →
// 남은시간 넓힘·제공자 좁힘·authCode 넓힘으로 재배분(제공자가 authCode 쪽으로 당겨짐).
// 반응형: lg 미만은 중요 컬럼(ID·남은시간·상태)만 유동폭으로 표시하고
// 부차 컬럼(제공자/엔드포인트·authCode)은 hidden lg:block 으로 숨긴다. lg+ 는 전체 5컬럼.
// (authCode 의 기존 xl 브레이크포인트는 lg 단일로 통일 — lg 구간 빈 트랙 결함 제거)
const EDR_COLS =
  "grid-cols-[minmax(110px,1fr)_minmax(120px,1fr)_minmax(140px,1.3fr)_90px] lg:grid-cols-[170px_1.5fr_1.6fr_1.7fr_120px]";
import { ConfirmActionDialog } from "@/components/DetailDeleteDialogs";
import { DataTablePagination } from "@/components/DataTablePagination";
import { usePagination } from "@/lib/usePagination";
import { Copy, Shield, Key, Clock } from "lucide-react";
import { toast } from "sonner";

// 마스킹은 토큰 실제 바이트를 노출하지 않는다 — 길이만 대략 힌트한 점(•) 표시.
function maskToken(token: string) {
  if (!token) return "—";
  return "•".repeat(Math.min(12, Math.max(6, token.length)));
}

export default function PageEDR() {
  const { t } = useI18n();
  const connector = useConnectorStore(s => s.connector);
  const connectorId = connector?.id;
  const [alert, setAlert] = useState(true);
  const [confirmCopy, setConfirmCopy] = useState<string | null>(null);

  const {
    data: edrs = [],
    isError,
    isLoading,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["edrs", connectorId],
    queryFn: () => fetchEDRs(connectorId!),
    enabled: !!connectorId,
    refetchInterval: 30_000,
  });

  const defaultStats: EDRStats = {
    todayGcDeleted: 0,
    gcErrors: 0,
    nearestExpiry: null,
    gcScheduler: {
      interval: "—",
      batchSize: 0,
      grace: "—",
      lastRun: "—",
      nextRun: "—",
      enabled: false,
    },
  };
  const {
    data: stats = defaultStats,
    refetch: statsRefetch,
    isFetching: statsFetching,
  } = useQuery({
    queryKey: ["edr-stats", connectorId],
    queryFn: () => fetchEDRStats(connectorId!),
    enabled: !!connectorId,
    refetchInterval: 30_000,
  });

  // 만료된 EDR을 프론트에서 즉시 제거 + 남은 시간을 실시간 감소시키기 위한 시계 틱.
  // 서버 목록은 30초 폴링이라 그 사이 만료분이 남아 보이므로, 클라에서 expiresAt(원시 ms) 기준으로
  // 보정한다. 만료된 토큰은 이미 무효(제공자 데이터플레인이 거부)라 백엔드 삭제는 EDC GC 소관이다.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10_000); // 10초 틱(분 단위 표시라 충분)
    return () => clearInterval(id);
  }, []);

  // expiresAt 이 있으면 그 기준으로 남은 분을 실시간 재계산하고, 이미 만료(expiresAt <= now)된
  // 항목은 목록에서 제외한다. expiresAt 없으면 서버 left(-1=만료정보없음/활성) 그대로 유지.
  const liveEdrs = edrs
    .filter(e => !(e.expiresAt && e.expiresAt > 0 && e.expiresAt <= now))
    .map(e =>
      e.expiresAt && e.expiresAt > 0
        ? { ...e, left: Math.max(0, Math.ceil((e.expiresAt - now) / 60_000)) }
        : e
    );

  const {
    paginatedData,
    totalItems,
    currentPage,
    pageSize,
    setCurrentPage,
    setPageSize,
  } = usePagination(liveEdrs, 10);

  return (
    <>
      <SectionHdr
        icon={<Key className="w-5 h-5 text-primary" />}
        subtitle={t.pageSubtitles.edr}
        action={
          <RefreshButton
            // 목록(edrs)과 KPI 카드(edr-stats)를 함께 갱신 — 페이지 수준 버튼 의미와 일치.
            onRefresh={() => {
              refetch();
              statsRefetch();
            }}
            busy={isFetching || statsFetching}
            label={t.common.refresh}
          />
        }
      >
        {t.edr.title}
      </SectionHdr>

      {alert && stats.nearestExpiry && stats.nearestExpiry.left < 60 && (
        <AlertBanner variant="warn" onClose={() => setAlert(false)}>
          {t.edr.expiringWarning(
            stats.nearestExpiry.tpId,
            stats.nearestExpiry.left
          )}
        </AlertBanner>
      )}

      {/* AuthCode Copy Confirmation Modal (NF-23) */}
      <ConfirmActionDialog
        open={!!confirmCopy}
        onClose={() => setConfirmCopy(null)}
        title={t.edr.securityConfirm}
        description={t.edr.authCodeWarning}
        tone="warn"
        confirmLabel={t.edr.copyConfirm}
        onConfirm={() => {
          if (confirmCopy)
            navigator.clipboard.writeText(confirmCopy).then(
              () => toast.success(t.edr.authCodeCopied),
              () => toast.error(t.common.copyFailed)
            );
          setConfirmCopy(null);
        }}
      />

      {/* EDR List — Desktop */}
      <ListCard
        title={t.edr.listTitle}
        actions={
          <span className="text-[11px] text-muted-foreground">
            {t.edr.authCodeMasked}
          </span>
        }
        className="hidden md:block"
        responsive
      >
        {isError ? (
          <ListError onRetry={() => refetch()} fetching={isFetching} />
        ) : isLoading ? (
          <div className="py-8 text-center text-[12px] text-muted-foreground">
            {t.common.loading}
          </div>
        ) : liveEdrs.length === 0 ? (
          <ListEmpty icon={<Shield />} message={t.dashboard.noResults} />
        ) : (
          <>
            <ListHeaderRow cols={EDR_COLS}>
              <ListColLabel>{t.edr.col.id}</ListColLabel>
              <ListColLabel>{t.edr.col.remaining}</ListColLabel>
              <ListColLabel>
                {t.edr.col.provider} / {t.edr.col.endpoint}
              </ListColLabel>
              <ListColLabel className="hidden lg:block">
                {t.edr.col.authCode}
              </ListColLabel>
              <ListColLabel>{t.edr.col.status}</ListColLabel>
            </ListHeaderRow>
            {paginatedData.map(e => (
              <EDRRow
                key={e.tpId}
                edr={e}
                onCopyAuth={token => setConfirmCopy(token)}
              />
            ))}
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
          </>
        )}
      </ListCard>

      {/* Mobile: Card Stack */}
      <div className="md:hidden flex flex-col gap-3">
        {isError ? (
          <ListError onRetry={() => refetch()} fetching={isFetching} />
        ) : isLoading ? (
          <div className="py-8 text-center text-[12px] text-muted-foreground">
            {t.common.loading}
          </div>
        ) : liveEdrs.length === 0 ? (
          <ListEmpty icon={<Shield />} message={t.dashboard.noResults} />
        ) : (
          <>
            {paginatedData.map(e => (
              <EDRCard
                key={e.tpId}
                edr={e}
                onCopyAuth={token => setConfirmCopy(token)}
              />
            ))}
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
          </>
        )}
      </div>

      <Card
        title={
          <CardTitle icon={<Clock className="w-4 h-4 text-primary" />}>
            {t.edr.gcScheduler}
          </CardTitle>
        }
      >
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-[12px]">
          {[
            [t.edr.gcInterval, stats.gcScheduler.interval],
            [t.edr.gcBatchSize, fmtNum(stats.gcScheduler.batchSize)],
            [t.edr.gcGrace, stats.gcScheduler.grace],
            [t.edr.gcLastRun, stats.gcScheduler.lastRun],
            [t.edr.gcNextRun, stats.gcScheduler.nextRun],
            [t.edr.gcEnabled, stats.gcScheduler.enabled ? t.edr.enabled : "—"],
          ].map(([k, v]) => (
            <div key={k}>
              <div className="text-[11px] font-bold text-muted-foreground mb-1">
                {k}
              </div>
              <div
                className={`text-[11px] font-normal ${v === t.edr.enabled ? "text-primary" : "text-foreground/80"}`}
              >
                {v}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 text-[11px] text-muted-foreground">
          {t.edr.gcDeleteCondition}
        </div>
      </Card>
    </>
  );
}

/* ─── EDR Row (Desktop) ──────────────────────────────────────── */
function EDRRow({
  edr: e,
  onCopyAuth,
}: {
  edr: EDR;
  onCopyAuth: (token: string) => void;
}) {
  const { t, locale } = useI18n();
  const noExpiry = e.left < 0; // expiresAt 없음 → 활성으로 간주
  const pct = noExpiry ? 100 : Math.round((e.left / e.total) * 100);
  const isExpired = !noExpiry && e.left <= 0;
  const isCritical = !noExpiry && e.left < 10 && !isExpired;
  const isWarn = !noExpiry && e.left < 60 && !isCritical && !isExpired;

  const colorClass = isExpired
    ? "bg-muted-foreground/40"
    : isCritical
      ? "bg-rose-500"
      : isWarn
        ? "bg-amber-500"
        : "bg-blue-500";
  const timeColor = isExpired
    ? "text-muted-foreground"
    : isCritical
      ? "text-rose-600 dark:text-rose-300"
      : isWarn
        ? "text-amber-600 dark:text-amber-300"
        : "text-foreground";

  return (
    <ListRow cols={EDR_COLS}>
      <div className="min-w-0">
        <span className="text-xs font-bold text-primary block truncate">
          {e.tpId}
        </span>
        <div className="text-xs text-foreground truncate">{e.asset}</div>
      </div>
      <div className="min-w-0">
        <div className="flex justify-end text-[12px] mb-1">
          <span
            className={`font-medium ${timeColor} ${isCritical ? "animate-pulse" : ""}`}
          >
            {isExpired
              ? t.edr.expired
              : noExpiry
                ? t.edr.active
                : `${e.left}${locale === "ko" ? "분" : " min"}`}
          </span>
        </div>
        <ProgressBar value={pct} colorClass={colorClass} />
      </div>
      <div className="min-w-0 space-y-0.5">
        <span className="text-xs text-foreground truncate block" title={e.prov}>
          {e.prov}
        </span>
        <div className="flex items-center gap-1 min-w-0">
          <span
            className="text-xs text-muted-foreground truncate"
            title={e.endpoint || ""}
          >
            {e.endpoint || "—"}
          </span>
          {e.endpoint && (
            <button
              onClick={() => {
                navigator.clipboard.writeText(e.endpoint!).then(
                  () => toast.success(t.edr.endpointCopied),
                  () => toast.error(t.common.copyFailed)
                );
              }}
              className="opacity-60 hover:opacity-100 transition-opacity flex-shrink-0 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded"
              aria-label={t.edr.endpoint}
            >
              <Copy className="w-3 h-3 text-muted-foreground hover:text-foreground" />
            </button>
          )}
        </div>
      </div>
      <div className="hidden lg:block">
        <div className="flex items-center gap-1">
          <span className="text-xs text-foreground">
            {maskToken(e.authCode ?? "")}
          </span>
          {e.authCode && (
            <button
              onClick={() => onCopyAuth(e.authCode!)}
              aria-label={t.edr.copyAuthCode}
              className="opacity-60 hover:opacity-100 transition-opacity focus:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded"
            >
              <Copy className="w-3 h-3 text-muted-foreground" />
            </button>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 flex-wrap">
        <Badge
          variant={
            isExpired ? "gray" : isCritical ? "red" : isWarn ? "amber" : "green"
          }
        >
          {isExpired
            ? t.edr.expired
            : isCritical
              ? t.edr.critical
              : isWarn
                ? t.edr.expiring
                : t.edr.active}
        </Badge>
      </div>
    </ListRow>
  );
}

/* ─── EDR Card (Mobile) ──────────────────────────────────────── */
function EDRCard({
  edr: e,
  onCopyAuth,
}: {
  edr: EDR;
  onCopyAuth: (token: string) => void;
}) {
  const { t, locale } = useI18n();
  const noExpiry = e.left < 0;
  const pct = noExpiry ? 100 : Math.round((e.left / e.total) * 100);
  const isWarn = !noExpiry && e.left < 60;
  const isCritical = !noExpiry && e.left < 10;
  const colorClass = isCritical
    ? "bg-rose-500"
    : isWarn
      ? "bg-amber-500"
      : "bg-blue-500";

  return (
    <div className="bg-card rounded-xl p-3 shadow-sm border border-border">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold text-primary">{e.tpId}</span>
        <Badge variant={isCritical ? "red" : isWarn ? "amber" : "green"}>
          {isCritical ? t.edr.critical : isWarn ? t.edr.expiring : t.edr.active}
        </Badge>
      </div>
      <div className="text-xs text-foreground mb-2">
        {e.asset} · {e.prov}
      </div>
      <div className="flex items-center gap-2 text-[11px] mb-1">
        <span className="text-muted-foreground">{t.edr.remaining}</span>
        <span
          className={`font-medium ${isCritical ? "text-rose-600 dark:text-rose-300 animate-pulse" : isWarn ? "text-amber-600 dark:text-amber-300" : ""}`}
        >
          {noExpiry
            ? t.edr.active
            : `${e.left}${locale === "ko" ? "분" : " min"}`}
        </span>
      </div>
      <ProgressBar value={pct} colorClass={colorClass} />
      {e.authCode && (
        <div className="flex items-center gap-2 mt-2">
          <button
            onClick={() => onCopyAuth(e.authCode!)}
            className="text-[11px] text-primary hover:text-primary/80 font-medium flex items-center gap-1 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded"
          >
            <Copy className="w-3 h-3" /> {t.edr.copyAuthCode}
          </button>
        </div>
      )}
    </div>
  );
}
