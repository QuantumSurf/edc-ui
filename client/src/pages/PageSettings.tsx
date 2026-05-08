// Connector Hub — Settings Page
// Theme, Language, Profile, Notification preferences, System info

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useI18n, LOCALES, type Locale } from "@/i18n";
import { Card, SectionHdr, Badge, CardTitle, QuietButton, DataSourceBadge } from "@/components/ui-kmx";
import { ChevronLeft, User, Bell, Monitor, Info } from "lucide-react";
import { fetchSystemInfo } from "@/services/api";

interface PageSettingsProps {
  onNav: (path: string) => void;
}

export default function PageSettings({ onNav }: PageSettingsProps) {
  const { t } = useI18n();
  const { locale, setLocale } = useI18n();
  const { user } = useAuth();
  const { data: sysInfo } = useQuery({
    queryKey: ["system-info"],
    queryFn: fetchSystemInfo,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  return (
    <>
      <SectionHdr
        action={<QuietButton onClick={() => onNav("/fleet")} icon={<ChevronLeft className="w-3 h-3" />}>Fleet</QuietButton>}
      >
        {t.nav.settings}
      </SectionHdr>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* ── Appearance ──────────────────────────────────────── */}
        <Card title={<CardTitle icon={<Monitor className="w-3.5 h-3.5 text-blue-500" />}>{t.settings.appearance}</CardTitle>}>
          <div className="space-y-4">
            {/* Language */}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[13px] font-medium text-foreground">{t.settings.language}</div>
                <div className="text-[11px] text-muted-foreground">{t.settings.languageDesc}</div>
              </div>
              <div className="flex gap-1">
                {(Object.keys(LOCALES) as Locale[]).map((loc) => (
                  <button
                    key={loc}
                    onClick={() => setLocale(loc)}
                    className={`flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-lg border transition-colors ${
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
        <Card title={<CardTitle icon={<User className="w-3.5 h-3.5 text-blue-500" />}>{t.settings.profile}</CardTitle>}>
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
        <Card title={<CardTitle icon={<Bell className="w-3.5 h-3.5 text-blue-500" />}>{t.settings.notificationSettings}</CardTitle>}>
          <div className="space-y-3">
            <ToggleRow storageKey="notify.vcExpiry" label={t.settings.vcExpiry} desc={t.settings.vcExpiryDesc} defaultOn />
            <ToggleRow storageKey="notify.negTerminated" label={t.settings.negTerminated} desc={t.settings.negTerminatedDesc} defaultOn />
            <ToggleRow storageKey="notify.transferFailed" label={t.settings.transferFailed} desc={t.settings.transferFailedDesc} defaultOn />
            <ToggleRow storageKey="notify.edrExpiry" label={t.settings.edrExpiry} desc={t.settings.edrExpiryDesc} defaultOn />
            <ToggleRow storageKey="notify.connectorHealth" label={t.settings.connectorHealth} desc={t.settings.connectorHealthDesc} defaultOn />
          </div>
        </Card>

        {/* ── System Info ─────────────────────────────────────── */}
        <Card title={
          <CardTitle
            icon={<Info className="w-3.5 h-3.5 text-blue-500" />}
            badge={<DataSourceBadge mode={sysInfo ? "live" : "demo"} />}
          >{t.settings.systemInfo}</CardTitle>
        }>
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
        </Card>
      </div>
    </>
  );
}

/* ─── Helper: Profile Row ────────────────────────────────────── */
function ProfileRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
      <span className="text-[12px] text-muted-foreground">{label}</span>
      <span className="text-[12px] text-foreground font-medium">{value}</span>
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
        className={`w-9 h-5 rounded-full transition-colors flex items-center px-0.5 ${
          on ? "bg-blue-500 justify-end" : "bg-gray-300 dark:bg-gray-600 justify-start"
        }`}
      >
        <div className="w-4 h-4 rounded-full bg-white shadow-sm transition-transform" />
      </button>
    </div>
  );
}
