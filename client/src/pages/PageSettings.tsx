// Connector Hub — Settings Page
// Theme, Language, Profile, Notification preferences, System info

import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { useI18n, LOCALES, type Locale } from "@/i18n";
import { readPref, writePref } from "@/lib/prefs";
import {
  Card,
  SectionHdr,
  Badge,
  CardTitle,
  DataSourceBadge,
  FormField,
  inputBase,
  ListError,
  AlertBanner,
  PrimaryActionButton,
} from "@/components/ui-kmx";
import {
  User,
  Bell,
  Monitor,
  Sun,
  Moon,
  Info,
  Fingerprint,
  Loader2,
  Settings,
  Vault,
  Building2,
} from "lucide-react";
import {
  fetchSystemInfo,
  fetchIdentityHubConfig,
  updateIdentityHubConfig,
  fetchVaultConfig,
  fetchTenantInfo,
} from "@/services/api";
import { RoleGate } from "@/components/RoleGate";
import { toast } from "sonner";

export default function PageSettings() {
  const { t } = useI18n();
  const { locale, setLocale } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const { user } = useAuth();
  const {
    data: sysInfo,
    isError: sysError,
    refetch: sysRefetch,
    isFetching: sysFetching,
  } = useQuery({
    queryKey: ["system-info"],
    queryFn: fetchSystemInfo,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  return (
    <>
      <SectionHdr icon={<Settings className="w-5 h-5 text-primary" />} subtitle={t.pageSubtitles.settings}>
        {t.nav.settings}
      </SectionHdr>

      {/* ── 개인 환경설정 ───────────────────────────────────────── */}
      <h2 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mt-1">
        {t.settings.personalGroup}
      </h2>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* ── Appearance ──────────────────────────────────────── */}
        <Card
          title={
            <CardTitle icon={<Monitor className="w-3.5 h-3.5 text-blue-500" />}>
              <span className="font-bold">{t.settings.appearance}</span>
            </CardTitle>
          }
        >
          <div className="space-y-4">
            {/* Theme — 형제 과반(pcf·identityhub·aas)처럼 설정 외관 카드에 세그먼트 2버튼 */}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[13px] font-medium text-foreground">
                  {t.settings.theme}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {t.settings.themeDesc}
                </div>
              </div>
              <div
                className="flex gap-1"
                role="group"
                aria-label={t.settings.theme}
              >
                {(
                  [
                    ["light", t.settings.themeLight, Sun],
                    ["dark", t.settings.themeDark, Moon],
                  ] as const
                ).map(([mode, lbl, Icon]) => (
                  <button
                    key={mode}
                    onClick={() => {
                      if (theme !== mode) toggleTheme();
                    }}
                    aria-pressed={theme === mode}
                    className={`flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-lg border transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary ${
                      theme === mode
                        ? "border-primary bg-primary/10 text-primary font-medium"
                        : "border-border hover:bg-muted text-muted-foreground"
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" /> {lbl}
                  </button>
                ))}
              </div>
            </div>
            {/* Language */}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[13px] font-medium text-foreground">
                  {t.settings.language}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {t.settings.languageDesc}
                </div>
              </div>
              <div
                className="flex gap-1"
                role="group"
                aria-label={t.settings.language}
              >
                {(Object.keys(LOCALES) as Locale[]).map(loc => (
                  <button
                    key={loc}
                    onClick={() => setLocale(loc)}
                    aria-label={LOCALES[loc].label}
                    aria-pressed={locale === loc}
                    className={`flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-lg border transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary ${
                      locale === loc
                        ? "border-primary bg-primary/10 text-primary font-medium"
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
        <Card
          title={
            <CardTitle icon={<User className="w-3.5 h-3.5 text-blue-500" />}>
              <span className="font-bold">{t.settings.profile}</span>
            </CardTitle>
          }
        >
          <div className="space-y-3">
            <ProfileRow
              label={t.settings.username}
              value={user?.username ?? "—"}
            />
            <ProfileRow
              label={t.settings.displayName}
              value={user?.name ?? "—"}
            />
            <ProfileRow label={t.settings.email} value={user?.email ?? "—"} />
            <ProfileRow
              label={t.settings.role}
              value={
                <Badge
                  variant={
                    user?.role === "admin"
                      ? "blue"
                      : user?.role === "operator"
                        ? "teal"
                        : "gray"
                  }
                >
                  {user?.role ?? "viewer"}
                </Badge>
              }
            />
            <ProfileRow label={t.settings.authMethod} value="Keycloak OIDC" />
          </div>
        </Card>

        {/* ── Notifications ───────────────────────────────────── */}
        <Card
          title={
            <CardTitle icon={<Bell className="w-3.5 h-3.5 text-blue-500" />}>
              <span className="font-bold">
                {t.settings.notificationSettings}
              </span>
            </CardTitle>
          }
        >
          <div className="space-y-3">
            <ToggleRow
              storageKey="notify.vcExpiry"
              label={t.settings.vcExpiry}
              desc={t.settings.vcExpiryDesc}
              defaultOn
            />
            <ToggleRow
              storageKey="notify.negTerminated"
              label={t.settings.negTerminated}
              desc={t.settings.negTerminatedDesc}
              defaultOn
            />
            <ToggleRow
              storageKey="notify.transferFailed"
              label={t.settings.transferFailed}
              desc={t.settings.transferFailedDesc}
              defaultOn
            />
            <ToggleRow
              storageKey="notify.edrExpiry"
              label={t.settings.edrExpiry}
              desc={t.settings.edrExpiryDesc}
              defaultOn
            />
            <ToggleRow
              storageKey="notify.connectorHealth"
              label={t.settings.connectorHealth}
              desc={t.settings.connectorHealthDesc}
              defaultOn
            />
          </div>
        </Card>
      </div>

      {/* ── 조직·시스템 설정 ─────────────────────────────────────── */}
      <h2 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mt-4">
        {t.settings.systemGroup}
      </h2>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* ── System Info ─────────────────────────────────────── */}
        <Card
          title={
            <CardTitle
              icon={<Info className="w-3.5 h-3.5 text-blue-500" />}
              badge={
                sysError ? undefined : (
                  <DataSourceBadge mode={sysInfo ? "live" : "demo"} />
                )
              }
            >
              <span className="font-bold">{t.settings.systemInfo}</span>
            </CardTitle>
          }
        >
          {sysError ? (
            <ListError onRetry={() => sysRefetch()} fetching={sysFetching} />
          ) : (
            <div className="space-y-3">
              <ProfileRow
                label="Connector Hub"
                value={sysInfo?.connectorHub ?? "—"}
              />
              <ProfileRow
                label="EDC Runtime"
                value={sysInfo?.edcRuntime ?? "—"}
              />
              <ProfileRow
                label="DSP Version"
                value={sysInfo?.dspVersion ?? "—"}
              />
              <ProfileRow
                label="DCP Version"
                value={sysInfo?.dcpVersion ?? "—"}
              />
              <ProfileRow
                label={t.settings.environment}
                value={
                  <Badge
                    variant={sysInfo?.environment === "PROD" ? "blue" : "gray"}
                  >
                    {sysInfo?.environment ?? "—"}
                  </Badge>
                }
              />
              <ProfileRow
                label={t.settings.apiMode}
                value={
                  <Badge
                    variant={sysInfo?.apiMode === "Live" ? "teal" : "gray"}
                  >
                    {sysInfo?.apiMode ?? "—"}
                  </Badge>
                }
              />
            </div>
          )}
        </Card>

        {/* ── Organization (Tenant) ───────────────────────────── */}
        <Card
          title={
            <CardTitle
              icon={<Building2 className="w-3.5 h-3.5 text-blue-500" />}
            >
              <span className="font-bold">{t.settings.organization}</span>
            </CardTitle>
          }
        >
          <p className="text-[11px] text-muted-foreground mb-3">
            {t.settings.orgBpnDesc}
          </p>
          <OrgBpnSetting />
        </Card>

        {/* ── Identity Hub Server ─────────────────────────────── */}
        <Card
          title={
            <CardTitle
              icon={<Fingerprint className="w-3.5 h-3.5 text-blue-500" />}
            >
              <span className="font-bold">{t.settings.integration}</span>
            </CardTitle>
          }
        >
          <p className="text-[11px] text-muted-foreground mb-3">
            {t.settings.identityHubServerDesc}
          </p>
          <IdentityHubConfigSetting />
        </Card>

        {/* ── Vault Server ────────────────────────────────────── */}
        <Card
          title={
            <CardTitle icon={<Vault className="w-3.5 h-3.5 text-blue-500" />}>
              <span className="font-bold">{t.settings.vaultServer}</span>
            </CardTitle>
          }
        >
          <p className="text-[11px] text-muted-foreground mb-3">
            {t.settings.vaultServerDesc}
          </p>
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
function SettingFooter({
  dirty,
  saving,
  onSave,
  onDiscard,
}: {
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
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
          icon={
            saving ? <Loader2 className="w-3 h-3 animate-spin" /> : undefined
          }
        >
          {t.settings.save}
        </PrimaryActionButton>
      </div>
    </RoleGate>
  );
}

/* ─── Organization BPN (read-only) ───────────────────────────── */
// The org's BPN is the tenant's identifier — also the login id, and the BPN
// applied to every connector registered under this organization. It is shown
// for reference only and must not be edited from the UI.
function OrgBpnSetting() {
  const { t } = useI18n();
  const [bpn, setBpn] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const reload = () => {
    setLoading(true);
    setLoadError(false);
    fetchTenantInfo()
      .then(info => setBpn(info.bpn))
      .catch(e => {
        setLoadError(true);
        toast.error((e as Error).message);
      })
      .finally(() => setLoading(false));
  };
  useEffect(reload, []);

  if (loadError && !loading)
    return <ListError onRetry={reload} fetching={loading} />;

  return (
    <FormField label={t.settings.orgBpn}>
      <input
        value={bpn}
        readOnly
        placeholder="BPNL000000000000"
        className={`${inputBase} mono`}
      />
    </FormField>
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
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);

  const reload = () => {
    setLoading(true);
    setLoadError(false);
    fetchIdentityHubConfig()
      .then(c => {
        setUrl(c.url);
        setParticipantId(c.participantId);
        setHasApiKey(c.hasApiKey);
      })
      .catch(e => {
        setLoadError(true);
        toast.error((e as Error).message);
      })
      .finally(() => setLoading(false));
  };
  useEffect(reload, []);

  // URL·참여자ID는 읽기 전용(공유 인프라 / BPN 파생) — 편집 가능한 건 API 키뿐이다.
  const dirty = apiKey.length > 0;

  const discard = () => setApiKey("");

  const save = async () => {
    setSaving(true);
    try {
      const next = await updateIdentityHubConfig({
        url,
        participantId,
        apiKey,
      });
      setUrl(next.url);
      setParticipantId(next.participantId);
      setHasApiKey(next.hasApiKey);
      setApiKey("");
      toast.success(t.settings.identityHubConfigSaved);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const inputCls = `${inputBase} mono`;

  if (loadError && !loading)
    return <ListError onRetry={reload} fetching={loading} />;

  return (
    <div className="space-y-3">
      {!canEdit && <ReadOnlyNotice />}
      <FormField
        label={t.settings.identityHubUrl}
        hint={t.settings.identityHubUrlDesc}
      >
        <input value={url} readOnly className={inputCls} />
      </FormField>
      <FormField
        label={t.settings.identityHubParticipantId}
        hint={t.settings.identityHubParticipantIdDesc}
      >
        <input value={participantId} readOnly className={inputCls} />
        {/* 맨 BPN은 서버에서 카탈로그/DSP 요청 시 DID로 정규화됨 — 커넥터 DID와 동일 참가자임을 표시(표시 전용) */}
        {/^BPNL[0-9A-Z]+$/i.test(participantId.trim()) && (
          <p className="text-[10px] text-muted-foreground mt-1 break-all">
            {t.settings.didPreviewLabel}{" "}
            <span className="mono">
              did:web:identityhub:participants:{participantId.trim()}
            </span>
          </p>
        )}
      </FormField>
      <FormField
        label={t.settings.identityHubApiKey}
        hint={t.settings.identityHubApiKeyDesc}
      >
        <input
          type="password"
          value={apiKey}
          onChange={e => setApiKey(e.target.value)}
          placeholder={
            hasApiKey
              ? t.settings.identityHubApiKeySet
              : t.settings.identityHubApiKeyUnset
          }
          disabled={loading || !canEdit}
          autoComplete="new-password"
          className={inputCls}
        />
      </FormField>
      <SettingFooter
        dirty={dirty}
        saving={saving || loading}
        onSave={save}
        onDiscard={discard}
      />
    </div>
  );
}

/* ─── Vault server config (read-only diagnostic) ─────────────── */
// Vault 연결은 플랫폼 인프라(env PLATFORM_VAULT_*)로만 관리한다. 멀티테넌트 SaaS 에서
// 런타임 재지정을 허용하면 한 테넌트 admin 이 전역 Vault 를 자기 서버로 돌려 타 테넌트
// 시크릿을 가로챌 수 있어(CWE-639) 서버가 prod 에서 쓰기를 403 으로 막는다. 따라서 이
// 카드는 현재 연결 상태만 보여주는 읽기 전용 진단 패널이다(토큰 값은 노출하지 않음).
function VaultConfigSetting() {
  const { t } = useI18n();
  const [url, setUrl] = useState("");
  const [namespace, setNamespace] = useState("");
  const [hasToken, setHasToken] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const reload = () => {
    setLoading(true);
    setLoadError(false);
    fetchVaultConfig()
      .then(c => {
        setUrl(c.url);
        setNamespace(c.namespace);
        setHasToken(c.hasToken);
      })
      .catch(e => {
        setLoadError(true);
        toast.error((e as Error).message);
      })
      .finally(() => setLoading(false));
  };
  useEffect(reload, []);

  const inputCls = `${inputBase} mono`;

  if (loadError && !loading)
    return <ListError onRetry={reload} fetching={loading} />;

  return (
    <div className="space-y-3">
      <FormField label={t.settings.vaultUrl} hint={t.settings.vaultUrlDesc}>
        <input value={url} readOnly className={inputCls} />
      </FormField>
      <FormField
        label={t.settings.vaultNamespace}
        hint={t.settings.vaultNamespaceDesc}
      >
        <input value={namespace} readOnly className={inputCls} />
      </FormField>
      <FormField label={t.settings.vaultToken}>
        <input
          type="password"
          value=""
          readOnly
          placeholder={
            hasToken ? t.settings.vaultTokenSet : t.settings.vaultTokenUnset
          }
          className={inputCls}
        />
      </FormField>
    </div>
  );
}

/* ─── Helper: Profile Row ────────────────────────────────────── */
function ProfileRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
      <span className="text-[12px] text-muted-foreground">{label}</span>
      <span className="text-[12px] text-foreground font-normal">{value}</span>
    </div>
  );
}

/* ─── Helper: Toggle Row (persisted via localStorage) ────────── */
function ToggleRow({
  storageKey,
  label,
  desc,
  defaultOn,
}: {
  storageKey: string;
  label: string;
  desc: string;
  defaultOn?: boolean;
}) {
  const [on, setOn] = useState(() => readPref(storageKey, defaultOn ?? false));
  const toggle = () => {
    setOn(prev => {
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
          on
            ? "bg-primary justify-end"
            : "bg-muted-foreground/40 justify-start"
        }`}
      >
        <div className="w-4 h-4 rounded-full bg-white shadow-sm transition-transform" />
      </button>
    </div>
  );
}
