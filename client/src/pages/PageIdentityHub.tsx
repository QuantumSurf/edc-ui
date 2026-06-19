// Connector Hub — IdentityHub status page
// 글로벌 설정의 IdentityHub URL 을 표시하고 외부 링크로 열 수 있게 한다.

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { Card, SectionHdr, CardTitle, MonoText, Badge } from "@/components/ui-kmx";
import {
  Fingerprint, AlertCircle, Loader2, Copy,
  Settings as SettingsIcon, Activity, RefreshCw, CheckCircle2, XCircle, UserCircle,
} from "lucide-react";
import {
  fetchIdentityHubUrl, fetchIdentityHubHealth, fetchIdentityHubParticipant,
  type IdentityHubHealth,
} from "@/services/api";
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
      <SectionHdr icon={<Fingerprint className="w-5 h-5 text-primary" />}>
        {t.identityHub.title}
      </SectionHdr>

      <HealthMonitorCard hasUrl={!!url && !loading} />

      <ParticipantInfoCard onNav={onNav} />

      <Card title={<CardTitle icon={<Fingerprint className="w-3.5 h-3.5 text-blue-500" />}><span className="font-bold">{t.identityHub.endpoint}</span></CardTitle>}>
        {loading ? (
          <div className="flex items-center justify-center py-6 gap-2 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-[13px]">{t.common.loading}</span>
          </div>
        ) : url ? (
          <div className="space-y-3">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-1">
                {t.identityHub.endpointUrl}
              </div>
              <div className="flex items-center gap-2 min-w-0 bg-muted/30 border border-border rounded p-2">
                <MonoText className="!text-[12px] !font-normal break-all flex-1 min-w-0">{url}</MonoText>
                <button
                  onClick={copy}
                  className="flex-shrink-0 p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                  title={t.common.copy}
                  aria-label={t.common.copy}
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
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

/* ─── Participant info card ───────────────────────────────────── */
function ParticipantInfoCard({ onNav }: { onNav: (path: string) => void }) {
  const { t } = useI18n();
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["identity-hub-participant"],
    queryFn: fetchIdentityHubParticipant,
    refetchOnWindowFocus: false,
    retry: 0,
  });

  const copy = (s: string) => { navigator.clipboard.writeText(s); toast.success(t.common.copied); };

  return (
    <Card title={
      <CardTitle icon={<UserCircle className="w-3.5 h-3.5 text-blue-500" />}>
        <span className="font-bold">{t.identityHub.participant}</span>
      </CardTitle>
    }>
      {isLoading ? (
        <div className="flex items-center justify-center py-6 gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-[13px]">{t.common.loading}</span>
        </div>
      ) : isError || !data ? (
        <div className="flex items-center gap-2 text-rose-600 py-4">
          <AlertCircle className="w-4 h-4" />
          <span className="text-[13px]">{t.common.loadFailed}</span>
        </div>
      ) : !data.configured ? (
        <div className="flex flex-col items-center justify-center py-6 gap-3">
          <div className="flex items-center gap-2 text-amber-600">
            <AlertCircle className="w-4 h-4" />
            <span className="text-[13px] font-medium">{t.identityHub.participantNotConfigured}</span>
          </div>
          <p className="text-[12px] text-muted-foreground text-center max-w-md">{t.identityHub.participantNotConfiguredHint}</p>
          <button
            onClick={() => onNav("/settings")}
            className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <SettingsIcon className="w-3 h-3" />
            {t.identityHub.openSettings}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-1">{t.identityHub.participantId}</div>
            <div className="flex items-center gap-2 min-w-0 bg-muted/30 border border-border rounded p-2">
              <MonoText className="!text-[12px] !font-normal break-all flex-1 min-w-0">{data.participantId}</MonoText>
              <button
                onClick={() => copy(data.participantId)}
                className="flex-shrink-0 p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                title={t.common.copy}
                aria-label={t.common.copy}
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          {data.did && (
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-1">{t.identityHub.did}</div>
              <div className="flex items-center gap-2 min-w-0 bg-muted/30 border border-border rounded p-2">
                <MonoText className="!text-[12px] !font-normal break-all flex-1 min-w-0">{data.did}</MonoText>
                <button
                  onClick={() => copy(data.did!)}
                  className="flex-shrink-0 p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                  title={t.common.copy}
                  aria-label={t.common.copy}
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
          <div className="pt-2 border-t border-border">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                {t.identityHub.credentials} ({data.credentials.length})
              </span>
              <button
                onClick={() => refetch()}
                disabled={isFetching}
                className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border border-border hover:bg-muted disabled:opacity-50"
              >
                <RefreshCw className={`w-3 h-3 ${isFetching ? "animate-spin" : ""}`} />
                {t.identityHub.refreshNow}
              </button>
            </div>
            {data.credentialError ? (
              <div className="flex items-start gap-2 text-[11px] text-rose-600 bg-rose-50 border border-rose-100 rounded px-2 py-1.5">
                <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                <span className="flex-1 min-w-0 break-all">
                  {t.identityHub.credentialFetchFailed}: {data.credentialError}
                  {/(\b401\b|unauthor)/i.test(data.credentialError) && (
                    <>
                      <span className="block mt-0.5 text-rose-600/80">{t.identityHub.credentialAuthHint}</span>
                      <button
                        onClick={() => onNav("/settings")}
                        className="mt-1.5 inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md border border-rose-200 text-rose-700 hover:bg-rose-100 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                      >
                        <SettingsIcon className="w-3 h-3" /> {t.identityHub.goToSettings}
                      </button>
                    </>
                  )}
                </span>
              </div>
            ) : data.credentials.length === 0 ? (
              <p className="text-[12px] text-muted-foreground py-2">{t.identityHub.noCredentials}</p>
            ) : (
              <ul className="space-y-1.5">
                {data.credentials.map((c, i) => (
                  <li key={i} className="px-2 py-1.5 rounded bg-muted/40 border border-border">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                      <span className="text-[12px] font-medium flex-1 min-w-0 truncate">{c.type}</span>
                      <Badge variant="gray">{c.status}</Badge>
                    </div>
                    {c.issuer && (
                      <MonoText className="!text-[11px] !font-normal text-muted-foreground truncate block mt-0.5">{c.issuer}</MonoText>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

/* ─── Health monitor card ─────────────────────────────────────── */
function HealthMonitorCard({ hasUrl }: { hasUrl: boolean }) {
  const { t, locale } = useI18n();
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
          <Metric label={t.identityHub.checkedAt} value={formatTs(data?.checkedAt ?? new Date(dataUpdatedAt).toISOString(), locale)} />
        </div>

        <div className="pt-2 border-t border-border">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{t.identityHub.components}</span>
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
                <li key={i} className="px-2 py-1.5 rounded bg-muted/40 border border-border">
                  <div className="flex items-center gap-2">
                    {c.isHealthy ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5 text-rose-500 flex-shrink-0" />
                    )}
                    <span className="text-[12px] flex-1 min-w-0 truncate">{c.component}</span>
                    <Badge variant={c.isHealthy ? "green" : "red"}>
                      {c.isHealthy ? t.identityHub.componentHealthy : t.identityHub.componentUnhealthy}
                    </Badge>
                  </div>
                  {!c.isHealthy && c.failure && (
                    <p className="text-[11px] text-rose-600 break-all mt-1 pl-[22px]">{c.failure}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {(isError || data?.error) && (
          <div className="flex items-start gap-2 text-[11px] text-rose-600 bg-rose-50 border border-rose-100 rounded px-2 py-1.5">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            <MonoText className="!text-[11px] !font-normal break-all flex-1 min-w-0">
              {data?.error ?? t.identityHub.requestFailed}
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
      <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{label}</div>
      <MonoText className="!text-[13px] !font-normal block truncate">{value}</MonoText>
    </div>
  );
}

function formatTs(iso: string, locale: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString(locale === "ko" ? "ko-KR" : "en-US");
}
