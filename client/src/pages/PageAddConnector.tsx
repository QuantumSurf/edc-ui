// Connector Hub — Add Connector (right-side slide panel)
// Fully functional: form state, test connection, register via API

import { useEffect, useState } from "react";
import { useI18n } from "@/i18n";
import { useAuth } from "@/contexts/AuthContext";
import { FormField, inputBase } from "@/components/ui-kmx";
import { SlidePanel, ConfirmActionDialog } from "@/components/DetailDeleteDialogs";
import { Plug, Loader2, CheckCircle2, XCircle, X } from "lucide-react";
import { toast } from "sonner";
import { testConnection, registerConnector, fetchTenantInfo } from "@/services";
import { useQueryClient } from "@tanstack/react-query";

interface AddConnectorPanelProps {
  open: boolean;
  onClose: () => void;
}

const ROLE_MAP: Record<string, string[]> = {
  both: ["Provider", "Consumer"],
  provider: ["Provider"],
  consumer: ["Consumer"],
};

export default function AddConnectorPanel({ open, onClose }: AddConnectorPanelProps) {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Form state
  const [name, setName] = useState("");
  const [bpn, setBpn] = useState("");
  const [managementUrl, setManagementUrl] = useState("");
  const [dspEndpoint, setDspEndpoint] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [role, setRole] = useState("both");
  const [env, setEnv] = useState("PROD");
  const [dcpVersion, setDcpVersion] = useState("1.0");
  const [did, setDid] = useState("");

  // UI state
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"ok" | "fail" | null>(null);
  const [registering, setRegistering] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  // 미저장 변경 여부 — 입력값이 초기 상태와 다르면 닫기 시 확인을 받는다(BPN은 읽기전용이라 제외).
  const dirty =
    Boolean(name.trim() || managementUrl.trim() || dspEndpoint.trim() || apiKey || did.trim()) ||
    role !== "both" || env !== "PROD" || dcpVersion !== "1.0";
  const requestClose = () => { if (dirty) setConfirmClose(true); else onClose(); };

  // Reset form each time the panel opens. BPN defaults to the user's own
  // organization (tenant) BPN — editable for the rare multi-BPN case.
  useEffect(() => {
    if (open) {
      setName("");
      // BPN is managed in Settings — show the org BPN (fresh), read-only here.
      setBpn(user?.tenantBpn ?? "");
      fetchTenantInfo().then((info) => { if (info.bpn) setBpn(info.bpn); }).catch(() => {});
      setManagementUrl("");
      setDspEndpoint("");
      setApiKey("");
      setRole("both");
      setEnv("PROD");
      setDcpVersion("1.0");
      setDid("");
      setTestResult(null);
      setConfirmClose(false);
    }
  }, [open]);

  const isValid = name.trim() && managementUrl.trim() && dspEndpoint.trim();

  const handleTestConnection = async () => {
    if (!managementUrl.trim()) {
      toast.error(t.addConnector.managementUrl + " is required");
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testConnection(managementUrl, apiKey || undefined);
      setTestResult(result.status);
      if (result.status === "ok") {
        toast.success(t.addConnector.testSuccess ?? "Connection successful");
      } else {
        toast.error(t.addConnector.testFail ?? "Connection failed");
      }
    } catch (err: unknown) {
      setTestResult("fail");
      const msg = err instanceof Error ? err.message : "Connection failed";
      toast.error(msg);
    } finally {
      setTesting(false);
    }
  };

  const handleRegister = async () => {
    if (!isValid) {
      toast.error(t.addConnector.fillRequired ?? "Please fill required fields");
      return;
    }
    setRegistering(true);
    try {
      await registerConnector({
        name: name.trim(),
        bpn: bpn.trim(),
        managementUrl: managementUrl.trim(),
        dspEndpoint: dspEndpoint.trim(),
        apiKey: apiKey || undefined,
        env,
        roles: ROLE_MAP[role] ?? ["Provider", "Consumer"],
        dcpVersion,
        did: did.trim() || undefined,
      });
      queryClient.invalidateQueries({ queryKey: ["connectors"] });
      queryClient.invalidateQueries({ queryKey: ["fleet-kpi"] });
      toast.success(t.addConnector.registered);
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Registration failed";
      toast.error(msg);
    } finally {
      setRegistering(false);
    }
  };

  const inputClass = inputBase;

  return (
    <SlidePanel open={open} onClose={() => { if (!confirmClose) requestClose(); }} className="max-w-xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Plug className="w-4 h-4 text-blue-500 flex-shrink-0" />
          <span className="text-[15px] font-semibold text-foreground truncate">{t.addConnector.register}</span>
        </div>
        <button
          onClick={requestClose}
          aria-label={t.common.close}
          className="-mr-1 p-1 rounded hover:bg-muted text-muted-foreground flex-shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5 min-w-0">
        {/* Basic Info */}
        <div>
          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-3">{t.addConnector.basicInfo}</div>
          <div className="grid grid-cols-1 gap-4">
            <FormField label={t.addConnector.connectorName} required>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="KMX-PROD-03"
                className={inputClass}
              />
            </FormField>
            {/* 조직 BPN — 읽기전용(설정에서 관리). 어떤 조직으로 등록되는지 컨텍스트 제공 */}
            <FormField
              label={locale === "ko" ? "조직 BPN" : "Organization BPN"}
              hint={locale === "ko" ? "설정에서 변경할 수 있습니다." : "Managed in Settings."}
            >
              <input
                value={bpn}
                readOnly
                disabled
                placeholder="BPNL000000000000"
                className={`${inputClass} mono opacity-70 cursor-not-allowed`}
              />
            </FormField>
          </div>
        </div>

        {/* Endpoints */}
        <div>
          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-3">{t.addConnector.endpoints}</div>
          <div className="space-y-3">
            <FormField label={t.addConnector.managementUrl} required>
              <div className="flex gap-2">
                <input
                  value={managementUrl}
                  onChange={(e) => { setManagementUrl(e.target.value); setTestResult(null); }}
                  placeholder="https://edc-cp-03.kmx.io/management"
                  className={`${inputClass} mono flex-1`}
                />
                {testResult && (
                  <span
                    role="status"
                    className={`flex items-center gap-1 self-center flex-shrink-0 text-[11px] font-medium ${testResult === "ok" ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}
                  >
                    {testResult === "ok" ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                    {testResult === "ok" ? t.addConnector.testSuccess : t.addConnector.testFail}
                  </span>
                )}
              </div>
            </FormField>
            <FormField label={t.addConnector.dspEndpoint} required>
              <input
                value={dspEndpoint}
                onChange={(e) => setDspEndpoint(e.target.value)}
                placeholder="https://edc-cp-03.kmx.io/api/v1/dsp"
                className={`${inputClass} mono`}
              />
            </FormField>
          </div>
        </div>

        {/* Auth & Role */}
        <div>
          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-3">{t.addConnector.authAndRole}</div>
          <div className="grid grid-cols-1 gap-4">
            <FormField label={t.addConnector.apiKey}>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => { setApiKey(e.target.value); setTestResult(null); }}
                placeholder="••••••••"
                className={inputClass}
              />
            </FormField>
            <FormField label={t.addConnector.role}>
              <select value={role} onChange={(e) => setRole(e.target.value)} className={inputClass}>
                <option value="both">{t.addConnector.roleProviderConsumer}</option>
                <option value="provider">{t.addConnector.roleProvider}</option>
                <option value="consumer">{t.addConnector.roleConsumer}</option>
              </select>
            </FormField>
            <FormField label={t.addConnector.environment}>
              <select value={env} onChange={(e) => setEnv(e.target.value)} className={inputClass}>
                <option value="PROD">{t.addConnector.envProd}</option>
                <option value="STG">{t.addConnector.envStg}</option>
                <option value="DEV">{t.addConnector.envDev}</option>
              </select>
            </FormField>
            <FormField label={t.addConnector.dcpVersion}>
              <select value={dcpVersion} onChange={(e) => setDcpVersion(e.target.value)} className={inputClass}>
                <option value="1.0">DCP 1.0</option>
                <option value="0.8">DCP 0.8 {t.addConnector.dcpLegacy}</option>
              </select>
            </FormField>
          </div>
        </div>

        {/* DID / IdentityHub */}
        <div>
          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-3">{t.addConnector.dcpTrust}</div>
          <div className="space-y-3">
            <FormField label={t.addConnector.did}>
              <input
                value={did}
                onChange={(e) => setDid(e.target.value)}
                placeholder="did:web:kmx.io:participants:kmx-prod-03"
                className={`${inputClass} mono`}
              />
            </FormField>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex justify-end gap-2 px-3 py-2.5 border-t border-border bg-muted/20 flex-shrink-0">
        <button
          onClick={handleTestConnection}
          disabled={testing || !managementUrl.trim()}
          className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded border border-border hover:bg-muted transition-colors text-muted-foreground disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
        >
          {testing && <Loader2 className="w-3 h-3 animate-spin" />}
          {t.addConnector.testConnection}
        </button>
        <button
          onClick={handleRegister}
          disabled={registering || !isValid}
          className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded bg-primary hover:bg-primary/90 text-primary-foreground font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
        >
          {registering && <Loader2 className="w-3 h-3 animate-spin" />}
          {t.addConnector.register}
        </button>
      </div>

      {/* 미저장 변경 가드 */}
      <ConfirmActionDialog
        open={confirmClose}
        onClose={() => setConfirmClose(false)}
        title={t.common.unsavedChanges}
        description={t.common.unsavedChangesDesc}
        tone="warn"
        cancelLabel={t.common.stay}
        confirmLabel={t.common.leave}
        onConfirm={() => { setConfirmClose(false); onClose(); }}
      />
    </SlidePanel>
  );
}
