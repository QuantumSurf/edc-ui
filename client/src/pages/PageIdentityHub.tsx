// Connector Hub — IdentityHub status page
// 글로벌 설정의 IdentityHub URL 을 표시하고 외부 링크로 열 수 있게 한다.

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { Card, SectionHdr, CardTitle, MonoText, Badge } from "@/components/ui-kmx";
import {
  Fingerprint, ExternalLink, AlertCircle, Loader2, Copy,
  Settings as SettingsIcon, Activity, RefreshCw, CheckCircle2, XCircle,
} from "lucide-react";
import { fetchIdentityHubUrl, fetchIdentityHubHealth, type IdentityHubHealth } from "@/services/api";
import { toast } from "sonner";

interface PageIdentityHubProps {
  onNav: (path: string) => void;
}

export default function PageIdentityHub({ onNav }: PageIdentityHubProps) {
  const { t } = useI18n();
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchIdentityHubUrl()
      .then((v) => setUrl(v))
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const copy = () => { navigator.clipboard.writeText(url); toast.success(t.common.copied); };

  return (
    <>
      <SectionHdr breadcrumb={t.identityHub.subtitle}>
        {t.identityHub.title}
      </SectionHdr>

      <HealthMonitorCard hasUrl={!!url && !loading} />

      <Card title={<CardTitle icon={<Fingerprint className="w-3.5 h-3.5 text-blue-500" />}><span className="font-bold">{t.identityHub.endpoint}</span></CardTitle>}>
        {loading ? (
          <div className="flex items-center justify-center py-6 gap-2 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-[13px]">{t.common.loading}</span>
          </div>
        ) : url ? (
          <div className="space-y-3">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                {t.identityHub.endpointUrl}
              </div>
              <div className="flex items-center gap-2 min-w-0">
                <MonoText className="!text-[12px] !font-normal break-all flex-1 min-w-0">{url}</MonoText>
                <button
                  onClick={copy}
                  className="flex-shrink-0 p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                  title={t.common.copy}
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="flex items-center gap-1 text-[12px] px-2.5 py-1 rounded border border-border hover:bg-muted flex-shrink-0"
                >
                  <ExternalLink className="w-3 h-3" />
                  {t.identityHub.open}
                </a>
              </div>
            </div>
            <div className="flex items-center gap-2 pt-2 border-t border-border">
              <Badge variant="teal">{t.identityHub.statusConfigured}</Badge>
              <span className="text-[11px] text-muted-foreground">{t.identityHub.sharedNote}</span>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-6 gap-3">
            <div className="flex items-center gap-2 text-amber-600">
              <AlertCircle className="w-4 h-4" />
              <span className="text-[13px] font-medium">{t.identityHub.notConfigured}</span>
            </div>
            <p className="text-[12px] text-muted-foreground text-center max-w-md">{t.identityHub.notConfiguredHint}</p>
            <button
              onClick={() => onNav("/settings")}
              className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <SettingsIcon className="w-3 h-3" />
              {t.identityHub.openSettings}
            </button>
          </div>
        )}
      </Card>
    </>
  );
}

/* ─── Health monitor card ─────────────────────────────────────── */
function HealthMonitorCard({ hasUrl }: { hasUrl: boolean }) {
  const { t } = useI18n();
  const { data, isFetching, isError, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["identity-hub-health"],
    queryFn: fetchIdentityHubHealth,
    enabled: hasUrl,
    refetchInterval: 10_000,
    refetchOnWindowFocus: false,
    retry: 0,
  });

  if (!hasUrl) return null;

  const status = data?.status ?? "unconfigured";
  const variant: "green" | "amber" | "red" | "gray" =
    status === "up" ? "green" : status === "warn" ? "amber" : status === "down" ? "red" : "gray";
  const statusLabel =
    status === "up" ? t.identityHub.statusUp
    : status === "warn" ? t.identityHub.statusWarn
    : status === "down" ? t.identityHub.statusDown
    : t.identityHub.statusUnconfigured;

  return (
    <Card title={
      <CardTitle
        icon={<Activity className="w-3.5 h-3.5 text-blue-500" />}
        badge={<Badge variant={variant}>{statusLabel}</Badge>}
      >
        <span className="font-bold">{t.identityHub.monitor}</span>
      </CardTitle>
    }>
      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Metric label={t.identityHub.httpStatus} value={data?.httpStatus != null ? String(data.httpStatus) : "—"} />
          <Metric label={t.identityHub.latency} value={data?.latencyMs != null ? `${data.latencyMs} ms` : "—"} />
          <Metric label={t.identityHub.checkedAt} value={formatTs(data?.checkedAt ?? new Date(dataUpdatedAt).toISOString())} />
        </div>

        <div className="pt-2 border-t border-border">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{t.identityHub.components}</span>
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border border-border hover:bg-muted disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${isFetching ? "animate-spin" : ""}`} />
              {t.identityHub.refreshNow}
            </button>
          </div>
          {(data?.components ?? []).length === 0 ? (
            <p className="text-[12px] text-muted-foreground py-2">{t.identityHub.noComponents}</p>
          ) : (
            <ul className="space-y-1.5">
              {(data?.components ?? []).map((c, i) => (
                <li key={i} className="flex items-center gap-2 px-2 py-1.5 rounded bg-muted/40 border border-border">
                  {c.isHealthy ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                  ) : (
                    <XCircle className="w-3.5 h-3.5 text-rose-500 flex-shrink-0" />
                  )}
                  <span className="text-[12px] flex-1 min-w-0 truncate">{c.component}</span>
                  <Badge variant={c.isHealthy ? "green" : "red"}>
                    {c.isHealthy ? t.identityHub.componentHealthy : t.identityHub.componentUnhealthy}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>

        {(isError || data?.error) && (
          <div className="flex items-start gap-2 text-[11px] text-rose-600 bg-rose-50 border border-rose-100 rounded px-2 py-1.5">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            <MonoText className="!text-[11px] !font-normal break-all flex-1 min-w-0">
              {data?.error ?? "request failed"}
            </MonoText>
          </div>
        )}

        <p className="text-[10px] text-muted-foreground text-right">{t.identityHub.autoRefresh}</p>
      </div>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-muted/30 border border-border rounded p-2 min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <MonoText className="!text-[13px] !font-normal block truncate">{value}</MonoText>
    </div>
  );
}

function formatTs(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString();
}
