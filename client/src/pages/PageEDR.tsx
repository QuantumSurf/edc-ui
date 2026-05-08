// Connector Hub — EDR Token Management (spec 4.7)
// Expiry color coding, authCode masking with copy confirmation modal (NF-23)

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { fetchEDRs, fetchEDRStats } from "@/services";
import { type EDR, type EDRStats } from "@/lib/data";
import { useConnectorStore } from "@/stores/connectorStore";
import { Card, KpiCard, Badge, AlertBanner, MonoText, ProgressBar, SectionHdr } from "@/components/ui-kmx";
import { ConfirmActionDialog } from "@/components/DetailDeleteDialogs";
import { Copy, Clock, Shield, Trash2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

function maskToken(token: string) {
  if (!token || token.length <= 12) return token || "—";
  return token.slice(0, 10) + "...";
}

export default function PageEDR() {
  const { t } = useI18n();
  const connector = useConnectorStore((s) => s.connector);
  const connectorId = connector?.id;
  const [alert, setAlert] = useState(true);
  const [confirmCopy, setConfirmCopy] = useState<string | null>(null);

  const { data: edrs = [] } = useQuery({
    queryKey: ["edrs", connectorId],
    queryFn: () => fetchEDRs(connectorId!),
    enabled: !!connectorId,
    refetchInterval: 30_000,
  });

  const defaultStats: EDRStats = {
    todayGcDeleted: 0, gcErrors: 0, nearestExpiry: null,
    gcScheduler: { interval: "—", batchSize: 0, grace: "—", lastRun: "—", nextRun: "—", enabled: false },
  };
  const { data: stats = defaultStats } = useQuery({
    queryKey: ["edr-stats", connectorId],
    queryFn: () => fetchEDRStats(connectorId!),
    enabled: !!connectorId,
    refetchInterval: 30_000,
  });

  const expiringCount = edrs.filter((e) => e.left >= 0 && e.left < 60).length;

  return (
    <>
      <SectionHdr breadcrumb={connector ? `${connector.name} / ${connector.bpn}` : undefined}>{t.edr.title}</SectionHdr>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          icon={<Shield className="w-[18px] h-[18px] text-blue-600" />}
          iconBg="bg-blue-50" label={t.edr.activeEdr} value={edrs.length} valueColor="text-blue-600"
        />
        <KpiCard
          icon={<Clock className="w-[18px] h-[18px] text-amber-600" />}
          iconBg="bg-amber-50" label={t.edr.expiringSoon} value={expiringCount} valueColor="text-amber-600"
        />
        <KpiCard
          icon={<Trash2 className="w-[18px] h-[18px] text-gray-600" />}
          iconBg="bg-gray-50" label={t.edr.todayGcDeleted} value={stats.todayGcDeleted}
        />
        <KpiCard
          icon={<AlertTriangle className="w-[18px] h-[18px] text-rose-600" />}
          iconBg="bg-rose-50" label={t.edr.gcErrors} value={stats.gcErrors} valueColor={stats.gcErrors > 0 ? "text-rose-600" : "text-blue-600"}
        />
      </div>

      {alert && stats.nearestExpiry && stats.nearestExpiry.left < 60 && (
        <AlertBanner variant="warn" onClose={() => setAlert(false)}>
          {t.edr.expiringWarning(stats.nearestExpiry.tpId, stats.nearestExpiry.left)}
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

      {/* EDR List — Desktop Table */}
      <Card
        title={t.edr.listTitle}
        actions={<span className="text-[12px] text-muted-foreground">{t.edr.authCodeMasked}</span>}
        className="hidden md:block"
      >
        <div className="space-y-0">
          {edrs.length === 0 ? (
            <div className="py-6 text-center text-[12px] text-muted-foreground">{t.dashboard.noResults}</div>
          ) : edrs.map((e, i) => (
            <EDRRow key={e.tpId} edr={e} isLast={i === edrs.length - 1} onCopyAuth={(token) => setConfirmCopy(token)} />
          ))}
        </div>
      </Card>

      {/* Mobile: Card Stack */}
      <div className="md:hidden flex flex-col gap-3">
        {edrs.length === 0 ? (
          <div className="py-6 text-center text-[13px] text-muted-foreground">{t.dashboard.noResults}</div>
        ) : edrs.map((e) => (
          <EDRCard key={e.tpId} edr={e} onCopyAuth={(token) => setConfirmCopy(token)} />
        ))}
      </div>

      <Card title={t.edr.gcScheduler}>
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
              <div className="text-[11px] text-muted-foreground mb-1">{k}</div>
              <div className={`mono text-[11px] ${v === t.edr.enabled ? "text-primary font-medium" : "text-foreground/80"}`}>{v}</div>
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

/* ─── EDR Table Row (Desktop) ────────────────────────────────── */
function EDRRow({ edr: e, isLast, onCopyAuth }: { edr: EDR; isLast: boolean; onCopyAuth: (token: string) => void }) {
  const { t } = useI18n();
  const noExpiry = e.left < 0;                          // expiresAt 없음 → 활성으로 간주
  const pct = noExpiry ? 100 : Math.round((e.left / e.total) * 100);
  const isExpired = !noExpiry && e.left <= 0;
  const isCritical = !noExpiry && e.left < 10 && !isExpired;
  const isWarn = !noExpiry && e.left < 60 && !isCritical && !isExpired;

  const colorClass = isExpired ? "bg-gray-400" : isCritical ? "bg-rose-500" : isWarn ? "bg-amber-500" : "bg-blue-500";
  const timeColor = isExpired ? "text-gray-400" : isCritical ? "text-rose-600" : isWarn ? "text-amber-600" : "text-foreground";

  return (
    <div className={`flex items-center gap-4 py-3 ${!isLast ? "border-b border-border" : ""}`}>
      <div className="w-28 flex-shrink-0">
        <MonoText className="text-[12px] font-normal block">{e.tpId}</MonoText>
        <div className="text-[12px] font-normal text-muted-foreground mt-0.5">{e.asset}</div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex justify-between text-[12px] mb-1.5">
          <span className="font-normal text-muted-foreground">{t.edr.remaining}</span>
          <span className={`font-normal ${timeColor} ${isCritical ? "animate-pulse" : ""}`}>
            {isExpired ? t.edr.expired : noExpiry ? t.edr.active : `${e.left}분`}
          </span>
        </div>
        <ProgressBar value={pct} colorClass={colorClass} />
      </div>
      <div className="w-20 flex-shrink-0">
        <div className="text-[12px] font-normal text-muted-foreground mb-0.5">{t.edr.provider}</div>
        <MonoText className="text-[12px] font-normal">{e.prov}</MonoText>
      </div>
      <div className="w-32 flex-shrink-0 hidden lg:block">
        <div className="text-[12px] font-normal text-muted-foreground mb-0.5">{t.edr.endpoint}</div>
        <div className="flex items-center gap-1">
          <MonoText className="text-[12px] font-normal truncate">{e.endpoint || "—"}</MonoText>
          {e.endpoint && (
            <button onClick={() => { navigator.clipboard.writeText(e.endpoint!); toast.success(t.edr.endpointCopied); }}>
              <Copy className="w-3 h-3 text-muted-foreground hover:text-foreground" />
            </button>
          )}
        </div>
      </div>
      <div className="w-28 flex-shrink-0 hidden xl:block">
        <div className="text-[12px] font-normal text-muted-foreground mb-0.5">{t.edr.authCode}</div>
        <div className="flex items-center gap-1">
          <MonoText className="text-[12px] font-normal">{maskToken(e.authCode ?? "")}</MonoText>
          {e.authCode && (
            <button onClick={() => onCopyAuth(e.authCode!)} className="opacity-60 hover:opacity-100 transition-opacity">
              <Copy className="w-3 h-3 text-muted-foreground" />
            </button>
          )}
        </div>
      </div>
      <Badge variant={isExpired ? "gray" : isCritical ? "red" : isWarn ? "amber" : "green"}>
        {isExpired ? t.edr.expired : isCritical ? t.edr.critical : isWarn ? t.edr.expiring : t.edr.active}
      </Badge>
      {noExpiry && (
        <span className="text-[12px] font-normal text-muted-foreground ml-1">(만료 없음)</span>
      )}
    </div>
  );
}

/* ─── EDR Card (Mobile) ──────────────────────────────────────── */
function EDRCard({ edr: e, onCopyAuth }: { edr: EDR; onCopyAuth: (token: string) => void }) {
  const { t } = useI18n();
  const noExpiry = e.left < 0;
  const pct = noExpiry ? 100 : Math.round((e.left / e.total) * 100);
  const isWarn = !noExpiry && e.left < 60;
  const isCritical = !noExpiry && e.left < 10;
  const colorClass = isCritical ? "bg-rose-500" : isWarn ? "bg-amber-500" : "bg-blue-500";

  return (
    <div className="bg-card rounded-xl p-3 shadow-sm border border-border">
      <div className="flex items-center justify-between mb-2">
        <MonoText className="text-[12px] font-medium">{e.tpId}</MonoText>
        <Badge variant={isCritical ? "red" : isWarn ? "amber" : "green"}>
          {isCritical ? t.edr.critical : isWarn ? t.edr.expiring : t.edr.active}
        </Badge>
      </div>
      <div className="text-[11px] text-muted-foreground mb-2">{e.asset} · {e.prov}</div>
      <div className="flex items-center gap-2 text-[11px] mb-1">
        <span className="text-muted-foreground">{t.edr.remaining}</span>
        <span className={`font-medium ${isCritical ? "text-rose-600 animate-pulse" : isWarn ? "text-amber-600" : ""}`}>
          {noExpiry ? t.edr.active : `${e.left}분`}
        </span>
      </div>
      <ProgressBar value={pct} colorClass={colorClass} />
      {e.authCode && (
        <div className="flex items-center gap-2 mt-2">
          <button onClick={() => onCopyAuth(e.authCode!)} className="text-[11px] text-primary hover:text-primary/80 font-medium flex items-center gap-1">
            <Copy className="w-3 h-3" /> {t.edr.copyAuthCode}
          </button>
        </div>
      )}
    </div>
  );
}
