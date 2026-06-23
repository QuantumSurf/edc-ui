// Connector Hub — EDR Token Management (spec 4.7)
// Expiry color coding, authCode masking with copy confirmation modal (NF-23)

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { fetchEDRs, fetchEDRStats } from "@/services";
import { type EDR, type EDRStats } from "@/lib/data";
import { useConnectorStore } from "@/stores/connectorStore";
import {
  Card,
  Badge,
  AlertBanner,
  ProgressBar,
  SectionHdr,
  CardTitle,
  ListCard,
  ListHeaderRow,
  ListRow,
  ListColLabel,
  ListEmpty,
  ListError,
} from "@/components/ui-kmx";

const EDR_COLS = "grid-cols-[170px_1.2fr_2.2fr_1.3fr_120px]";
import { ConfirmActionDialog } from "@/components/DetailDeleteDialogs";
import {
  DataTablePagination,
  usePagination,
} from "@/components/DataTablePagination";
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
  const { data: stats = defaultStats } = useQuery({
    queryKey: ["edr-stats", connectorId],
    queryFn: () => fetchEDRStats(connectorId!),
    enabled: !!connectorId,
    refetchInterval: 30_000,
  });

  const {
    paginatedData,
    totalItems,
    currentPage,
    pageSize,
    setCurrentPage,
    setPageSize,
  } = usePagination(edrs, 10);

  return (
    <>
      <SectionHdr icon={<Key className="w-5 h-5 text-primary" />}>
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
          if (confirmCopy) navigator.clipboard.writeText(confirmCopy);
          toast.success(t.edr.authCodeCopied);
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
      >
        {isError ? (
          <ListError onRetry={() => refetch()} fetching={isFetching} />
        ) : edrs.length === 0 ? (
          <ListEmpty icon={<Shield />} message={t.dashboard.noResults} />
        ) : (
          <>
            <ListHeaderRow cols={EDR_COLS}>
              <ListColLabel>{t.edr.col.id}</ListColLabel>
              <ListColLabel>{t.edr.col.remaining}</ListColLabel>
              <ListColLabel>
                {t.edr.col.provider} / {t.edr.col.endpoint}
              </ListColLabel>
              <ListColLabel className="hidden xl:block">
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
        ) : edrs.length === 0 ? (
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
            [t.edr.gcBatchSize, String(stats.gcScheduler.batchSize)],
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
                navigator.clipboard.writeText(e.endpoint!);
                toast.success(t.edr.endpointCopied);
              }}
              className="opacity-60 hover:opacity-100 transition-opacity flex-shrink-0 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded"
              aria-label={t.edr.endpoint}
            >
              <Copy className="w-3 h-3 text-muted-foreground hover:text-foreground" />
            </button>
          )}
        </div>
      </div>
      <div className="hidden xl:block">
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
