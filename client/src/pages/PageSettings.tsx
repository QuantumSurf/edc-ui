// Connector Hub — Settings Page
// Theme, Language, Profile, Notification preferences, System info

import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useI18n, LOCALES, type Locale } from "@/i18n";
import { Card, SectionHdr, Badge, CardTitle, QuietButton, DataSourceBadge, FormField, inputBase, ListError, AlertBanner, PrimaryActionButton } from "@/components/ui-kmx";
import { ChevronLeft, User, Bell, Monitor, Info, Fingerprint, Loader2, Settings, Vault, Building2 } from "lucide-react";
import {
  fetchSystemInfo, fetchIdentityHubConfig, updateIdentityHubConfig,
  fetchVaultConfig, updateVaultConfig, fetchTenantInfo, updateTenantBpn,
} from "@/services/api";
import { RoleGate } from "@/components/RoleGate";
import { toast } from "sonner";

interface PageSettingsProps {
  onNav: (path: string) => void;
}

export default function PageSettings({ onNav }: PageSettingsProps) {
  const { t } = useI18n();
  const { locale, setLocale } = useI18n();
  const { user } = useAuth();
  const { data: sysInfo, isError: sysError, refetch: sysRefetch, isFetching: sysFetching } = useQuery({
    queryKey: ["system-info"],
    queryFn: fetchSystemInfo,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  return (
    <>
      <SectionHdr
        icon={<Settings className="w-5 h-5 text-primary" />}
        breadcrumb={t.settings.subtitle}
        action={<QuietButton onClick={() => onNav("/fleet")} icon={<ChevronLeft className="w-3 h-3" />}>{t.nav.fleet}</QuietButton>}
      >
        {t.nav.settings}
      </SectionHdr>

      {/* ── 개인 환경설정 ───────────────────────────────────────── */}
      <h2 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mt-1">{t.settings.personalGroup}</h2>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* ── Appearance ──────────────────────────────────────── */}
        <Card title={<CardTitle icon={<Monitor className="w-3.5 h-3.5 text-blue-500" />}><span className="font-bold">{t.settings.appearance}</span></CardTitle>}>
          <div className="space-y-4">
            {/* Language */}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[13px] font-medium text-foreground">{t.settings.language}</div>
                <div className="text-[11px] text-muted-foreground">{t.settings.languageDesc}</div>
              </div>
              <div className="flex gap-1" role="group" aria-label={t.settings.language}>
                {(Object.keys(LOCALES) as Locale[]).map((loc) => (
                  <button
                    key={loc}
                    onClick={() => setLocale(loc)}
                    aria-label={LOCALES[loc].label}
                    aria-pressed={locale === loc}
                    className={`flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-lg border transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary ${
                      locale === loc
                        ? "border-blue-500 bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 font-medium"
                        : "border-border hover:bg-muted text-muted-foreground"
                    }`}
                  >
                    {LOCALES[loc].flag} {LOCALES[loc].label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Card>

        {/* ── Profile ─────────────────────────────────────────── */}
        <Card title={<CardTitle icon={<User className="w-3.5 h-3.5 text-blue-500" />}><span className="font-bold">{t.settings.profile}</span></CardTitle>}>
          <div className="space-y-3">
            <ProfileRow label={t.settings.username} value={user?.username ?? "—"} />
            <ProfileRow label={t.settings.displayName} value={user?.name ?? "—"} />
            <ProfileRow label={t.settings.email} value={user?.email ?? "—"} />
            <ProfileRow label={t.settings.role} value={
              <Badge variant={user?.role === "admin" ? "blue" : user?.role === "operator" ? "teal" : "gray"}>
                {user?.role ?? "viewer"}
              </Badge>
            } />
            <ProfileRow label={t.settings.authMethod} value="Keycloak OIDC" />
          </div>
        </Card>

        {/* ── Notifications ───────────────────────────────────── */}
        <Card title={<CardTitle icon={<Bell className="w-3.5 h-3.5 text-blue-500" />}><span className="font-bold">{t.settings.notificationSettings}</span></CardTitle>}>
          <div className="space-y-3">
            <ToggleRow storageKey="notify.vcExpiry" label={t.settings.vcExpiry} desc={t.settings.vcExpiryDesc} defaultOn />
            <ToggleRow storageKey="notify.negTerminated" label={t.settings.negTerminated} desc={t.settings.negTerminatedDesc} defaultOn />
            <ToggleRow storageKey="notify.transferFailed" label={t.settings.transferFailed} desc={t.settings.transferFailedDesc} defaultOn />
            <ToggleRow storageKey="notify.edrExpiry" label={t.settings.edrExpiry} desc={t.settings.edrExpiryDesc} defaultOn />
            <ToggleRow storageKey="notify.connectorHealth" label={t.settings.connectorHealth} desc={t.settings.connectorHealthDesc} defaultOn />
          </div>
        </Card>
      </div>

      {/* ── 조직·시스템 설정 ─────────────────────────────────────── */}
      <h2 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mt-4">{t.settings.systemGroup}</h2>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* ── System Info ─────────────────────────────────────── */}
        <Card title={
          <CardTitle
            icon={<Info className="w-3.5 h-3.5 text-blue-500" />}
            badge={sysError ? undefined : <DataSourceBadge mode={sysInfo ? "live" : "demo"} />}
          ><span className="font-bold">{t.settings.systemInfo}</span></CardTitle>
        }>
          {sysError ? (
            <ListError onRetry={() => sysRefetch()} fetching={sysFetching} />
          ) : (
          <div className="space-y-3">
            <ProfileRow label="Connector Hub" value={sysInfo?.connectorHub ?? "—"} />
            <ProfileRow label="EDC Runtime" value={sysInfo?.edcRuntime ?? "—"} />
            <ProfileRow label="DSP Version" value={sysInfo?.dspVersion ?? "—"} />
            <ProfileRow label="DCP Version" value={sysInfo?.dcpVersion ?? "—"} />
            <ProfileRow label={t.settings.environment} value={
              <Badge variant={sysInfo?.environment === "PROD" ? "blue" : "gray"}>
                {sysInfo?.environment ?? "—"}
              </Badge>
            } />
            <ProfileRow label={t.settings.apiMode} value={
              <Badge variant={sysInfo?.apiMode === "Live" ? "teal" : "gray"}>
                {sysInfo?.apiMode ?? "—"}
              </Badge>
            } />
          </div>
          )}
        </Card>

        {/* ── Organization (Tenant) ───────────────────────────── */}
        <Card title={<CardTitle icon={<Building2 className="w-3.5 h-3.5 text-blue-500" />}><span className="font-bold">{t.settings.organization}</span></CardTitle>}>
          <p className="text-[11px] text-muted-foreground mb-3">{t.settings.orgBpnDesc}</p>
          <OrgBpnSetting />
        </Card>

        {/* ── Identity Hub Server ─────────────────────────────── */}
        <Card title={<CardTitle icon={<Fingerprint className="w-3.5 h-3.5 text-blue-500" />}><span className="font-bold">{t.settings.integration}</span></CardTitle>}>
          <p className="text-[11px] text-muted-foreground mb-3">{t.settings.identityHubServerDesc}</p>
          <IdentityHubConfigSetting />
        </Card>

        {/* ── Vault Server ────────────────────────────────────── */}
        <Card title={<CardTitle icon={<Vault className="w-3.5 h-3.5 text-blue-500" />}><span className="font-bold">{t.settings.vaultServer}</span></CardTitle>}>
          <p className="text-[11px] text-muted-foreground mb-3">{t.settings.vaultServerDesc}</p>
          <VaultConfigSetting />
        </Card>
      </div>
    </>
  );
}

/* ─── Helper: read-only notice (non-admin) ───────────────────── */
function ReadOnlyNotice() {
  const { t } = useI18n();
  return (
    <div className="mb-3">
      <AlertBanner variant="info">{t.settings.readOnlyNotice}</AlertBanner>
    </div>
  );
}

/* ─── Helper: setting footer (discard + save, admin only) ─────── */
function SettingFooter({ dirty, saving, onSave, onDiscard }: {
  dirty: boolean; saving: boolean; onSave: () => void; onDiscard: () => void;
}) {
  const { t } = useI18n();
  return (
    <RoleGate permission="connector:write">
      <div className="flex justify-end gap-2">
        <button
          onClick={onDiscard}
          disabled={saving || !dirty}
          className="text-[11px] px-2.5 py-1 rounded-md border border-border hover:bg-muted text-muted-foreground transition-colors disabled:opacity-40 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
        >
          {t.settings.discard}
        </button>
        <PrimaryActionButton
          onClick={onSave}
          disabled={saving || !dirty}
          icon={saving ? <Loader2 className="w-3 h-3 animate-spin" /> : undefined}
        >
          {t.settings.save}
        </PrimaryActionButton>
      </div>
    </RoleGate>
  );
}

/* ─── Organization BPN (admin only) ──────────────────────────── */
// The org's BPN is the tenant's identifier — also the login id, and the BPN
// applied to every connector registered under this organization.
function OrgBpnSetting() {
  const { t } = useI18n();
  const { user } = useAuth();
  const canEdit = user?.role === "admin";
  const [bpn, setBpn] = useState("");
  const [original, setOriginal] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);

  const reload = () => {
    setLoading(true);
    setLoadError(false);
    fetchTenantInfo()
      .then((info) => { setBpn(info.bpn); setOriginal(info.bpn); })
      .catch((e) => { setLoadError(true); toast.error((e as Error).message); })
      .finally(() => setLoading(false));
  };
  useEffect(reload, []);

  const dirty = bpn.trim() !== original && bpn.trim().length > 0;

  const save = async () => {
    setSaving(true);
    try {
      const next = await updateTenantBpn(bpn.trim());
      setBpn(next.bpn);
      setOriginal(next.bpn);
      toast.success(t.settings.orgBpnSaved);
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(msg === "bpn-already-in-use" ? t.settings.orgBpnTaken : (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (loadError && !loading) return <ListError onRetry={reload} fetching={loading} />;

  return (
    <div className="space-y-3">
      {!canEdit && <ReadOnlyNotice />}
      <FormField label={t.settings.orgBpn} hint={t.settings.orgBpnHint}>
        <input
          value={bpn}
          onChange={(e) => setBpn(e.target.value)}
          placeholder="BPNL000000000000"
          disabled={loading || !canEdit}
          className={`${inputBase} mono`}
        />
      </FormField>
      <SettingFooter dirty={dirty} saving={saving || loading} onSave={save} onDiscard={() => setBpn(original)} />
    </div>
  );
}

/* ─── Identity Hub server config (admin only) ────────────────── */
// Connection settings the Decentralized Identity screen uses to fetch the
// participant's own info from the IdentityHub server.
function IdentityHubConfigSetting() {
  const { t } = useI18n();
  const { user } = useAuth();
  const canEdit = user?.role === "admin";
  const [url, setUrl] = useState("");
  const [participantId, setParticipantId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [hasApiKey, setHasApiKey] = useState(false);
  const [original, setOriginal] = useState({ url: "", participantId: "" });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);

  const reload = () => {
    setLoading(true);
    setLoadError(false);
    fetchIdentityHubConfig()
      .then((c) => {
        setUrl(c.url);
        setParticipantId(c.participantId);
        setHasApiKey(c.hasApiKey);
        setOriginal({ url: c.url, participantId: c.participantId });
      })
      .catch((e) => { setLoadError(true); toast.error((e as Error).message); })
      .finally(() => setLoading(false));
  };
  useEffect(reload, []);

  const dirty = url !== original.url || participantId !== original.participantId || apiKey.length > 0;

  const discard = () => {
    setUrl(original.url);
    setParticipantId(original.participantId);
    setApiKey("");
  };

  const save = async () => {
    setSaving(true);
    try {
      const next = await updateIdentityHubConfig({ url, participantId, apiKey });
      setUrl(next.url);
      setParticipantId(next.participantId);
      setHasApiKey(next.hasApiKey);
      setOriginal({ url: next.url, participantId: next.participantId });
      setApiKey("");
      toast.success(t.settings.identityHubConfigSaved);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const inputCls = `${inputBase} mono`;

  if (loadError && !loading) return <ListError onRetry={reload} fetching={loading} />;

  return (
    <div className="space-y-3">
      {!canEdit && <ReadOnlyNotice />}
      <FormField label={t.settings.identityHubUrl} hint={t.settings.identityHubUrlDesc}>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={t.settings.identityHubUrlPlaceholder}
          disabled={loading || !canEdit}
          className={inputCls}
        />
      </FormField>
      <FormField label={t.settings.identityHubParticipantId} hint={t.settings.identityHubParticipantIdDesc}>
        <input
          value={participantId}
          onChange={(e) => setParticipantId(e.target.value)}
          placeholder="BPNL000000000000"
          disabled={loading || !canEdit}
          className={inputCls}
        />
        {/* 맨 BPN은 서버에서 카탈로그/DSP 요청 시 DID로 정규화됨 — 커넥터 DID와 동일 참가자임을 표시(표시 전용) */}
        {/^BPNL[0-9A-Z]+$/i.test(participantId.trim()) && (
          <p className="text-[10px] text-muted-foreground mt-1 break-all">
            {t.settings.didPreviewLabel} <span className="mono">did:web:identityhub:participants:{participantId.trim()}</span>
          </p>
        )}
      </FormField>
      <FormField label={t.settings.identityHubApiKey} hint={t.settings.identityHubApiKeyDesc}>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={hasApiKey ? t.settings.identityHubApiKeySet : t.settings.identityHubApiKeyUnset}
          disabled={loading || !canEdit}
          autoComplete="new-password"
          className={inputCls}
        />
      </FormField>
      <SettingFooter dirty={dirty} saving={saving || loading} onSave={save} onDiscard={discard} />
    </div>
  );
}

/* ─── Vault server config (admin only) ───────────────────────── */
function VaultConfigSetting() {
  const { t } = useI18n();
  const { user } = useAuth();
  const canEdit = user?.role === "admin";
  const [url, setUrl] = useState("");
  const [namespace, setNamespace] = useState("");
  const [token, setToken] = useState("");
  const [hasToken, setHasToken] = useState(false);
  const [original, setOriginal] = useState({ url: "", namespace: "" });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);

  const reload = () => {
    setLoading(true);
    setLoadError(false);
    fetchVaultConfig()
      .then((c) => {
        setUrl(c.url);
        setNamespace(c.namespace);
        setHasToken(c.hasToken);
        setOriginal({ url: c.url, namespace: c.namespace });
      })
      .catch((e) => { setLoadError(true); toast.error((e as Error).message); })
      .finally(() => setLoading(false));
  };
  useEffect(reload, []);

  const dirty = url !== original.url || namespace !== original.namespace || token.length > 0;

  const discard = () => {
    setUrl(original.url);
    setNamespace(original.namespace);
    setToken("");
  };

  const save = async () => {
    setSaving(true);
    try {
      const next = await updateVaultConfig({ url, token, namespace });
      setUrl(next.url);
      setNamespace(next.namespace);
      setHasToken(next.hasToken);
      setOriginal({ url: next.url, namespace: next.namespace });
      setToken("");
      toast.success(t.settings.vaultConfigSaved);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const inputCls = `${inputBase} mono`;

  if (loadError && !loading) return <ListError onRetry={reload} fetching={loading} />;

  return (
    <div className="space-y-3">
      {!canEdit && <ReadOnlyNotice />}
      <FormField label={t.settings.vaultUrl} hint={t.settings.vaultUrlDesc}>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="http://platform-vault:8200"
          disabled={loading || !canEdit}
          className={inputCls}
        />
      </FormField>
      <FormField label={t.settings.vaultNamespace} hint={t.settings.vaultNamespaceDesc}>
        <input
          value={namespace}
          onChange={(e) => setNamespace(e.target.value)}
          placeholder="kmx/prod"
          disabled={loading || !canEdit}
          className={inputCls}
        />
      </FormField>
      <FormField label={t.settings.vaultToken} hint={t.settings.vaultTokenDesc}>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={hasToken ? t.settings.vaultTokenSet : t.settings.vaultTokenUnset}
          disabled={loading || !canEdit}
          autoComplete="new-password"
          className={inputCls}
        />
      </FormField>
      <SettingFooter dirty={dirty} saving={saving || loading} onSave={save} onDiscard={discard} />
    </div>
  );
}

/* ─── Helper: Profile Row ────────────────────────────────────── */
function ProfileRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
      <span className="text-[12px] text-muted-foreground">{label}</span>
      <span className="text-[12px] text-foreground font-normal">{value}</span>
    </div>
  );
}

/* ─── Helper: Toggle Row (persisted via localStorage) ────────── */
const NOTIFY_PREFS_KEY = "kmx-notify-prefs";

function readPref(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(NOTIFY_PREFS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Record<string, boolean>;
    return typeof parsed[key] === "boolean" ? parsed[key] : fallback;
  } catch { return fallback; }
}

function writePref(key: string, value: boolean): void {
  try {
    const raw = localStorage.getItem(NOTIFY_PREFS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
    parsed[key] = value;
    localStorage.setItem(NOTIFY_PREFS_KEY, JSON.stringify(parsed));
  } catch { /* storage may be unavailable */ }
}

function ToggleRow({
  storageKey, label, desc, defaultOn,
}: { storageKey: string; label: string; desc: string; defaultOn?: boolean }) {
  const [on, setOn] = useState(() => readPref(storageKey, defaultOn ?? false));
  const toggle = () => {
    setOn((prev) => {
      const next = !prev;
      writePref(storageKey, next);
      return next;
    });
  };
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
      <div>
        <div className="text-[12px] font-medium text-foreground">{label}</div>
        <div className="text-[11px] text-muted-foreground">{desc}</div>
      </div>
      <button
        onClick={toggle}
        role="switch"
        aria-checked={on}
        aria-label={label}
        className={`w-9 h-5 rounded-full transition-colors flex items-center px-0.5 flex-shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 ${
          on ? "bg-blue-500 justify-end" : "bg-muted-foreground/40 justify-start"
        }`}
      >
        <div className="w-4 h-4 rounded-full bg-white shadow-sm transition-transform" />
      </button>
    </div>
  );
}
