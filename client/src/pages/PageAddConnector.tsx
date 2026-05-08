// Connector Hub — Add Connector Page
// Fully functional: form state, test connection, register via API

import { useState } from "react";
import { useI18n } from "@/i18n";
import { Card, SectionHdr, FormField } from "@/components/ui-kmx";
import { ChevronLeft, Plug, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { testConnection, registerConnector } from "@/services";
import { useQueryClient } from "@tanstack/react-query";

interface PageAddConnectorProps {
  onNav: (page: string) => void;
}

const ROLE_MAP: Record<string, string[]> = {
  both: ["Provider", "Consumer"],
  provider: ["Provider"],
  consumer: ["Consumer"],
};

export default function PageAddConnector({ onNav }: PageAddConnectorProps) {
  const { t } = useI18n();
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
  const [identityHubUrl, setIdentityHubUrl] = useState("");

  // UI state
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"ok" | "fail" | null>(null);
  const [registering, setRegistering] = useState(false);

  const isValid = name.trim() && bpn.trim() && managementUrl.trim() && dspEndpoint.trim();

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
        identityHubUrl: identityHubUrl.trim() || undefined,
      });
      queryClient.invalidateQueries({ queryKey: ["connectors"] });
      toast.success(t.addConnector.registered);
      onNav("/fleet");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Registration failed";
      toast.error(msg);
    } finally {
      setRegistering(false);
    }
  };

  const inputClass = "w-full text-[12px] px-2.5 py-1.5 border border-border rounded-md bg-muted focus:outline-none focus:ring-1 focus:ring-blue-400";

  return (
    <>
      <SectionHdr action={
        <button
          onClick={() => onNav("/fleet")}
          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="w-3 h-3" />
          {t.nav.fleet}
        </button>
      }>
        {t.addConnector.register}
      </SectionHdr>

      <Card title={
        <span className="flex items-center gap-1.5">
          <Plug className="w-3.5 h-3.5 text-blue-500" />
          {t.addConnector.onboarding}
        </span>
      }>
        <div className="space-y-5">
          {/* Basic Info */}
          <div>
            <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-3">{t.addConnector.basicInfo}</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField label={t.addConnector.connectorName} required>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="KMX-PROD-03"
                  className={inputClass}
                />
              </FormField>
              <FormField label={t.addConnector.participantBpn} required>
                <input
                  value={bpn}
                  onChange={(e) => setBpn(e.target.value)}
                  placeholder="BPNL000000004KMX"
                  className={`${inputClass} mono`}
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
                  {testResult === "ok" && <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0 self-center" />}
                  {testResult === "fail" && <XCircle className="w-4 h-4 text-red-500 flex-shrink-0 self-center" />}
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                  <option value="0.8">DCP 0.8 (레거시)</option>
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
              <FormField label={t.addConnector.identityHubUrl}>
                <input
                  value={identityHubUrl}
                  onChange={(e) => setIdentityHubUrl(e.target.value)}
                  placeholder="http://identityhub:8183"
                  className={`${inputClass} mono`}
                />
              </FormField>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <button
              onClick={handleTestConnection}
              disabled={testing || !managementUrl.trim()}
              className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded border border-border hover:bg-muted transition-colors text-muted-foreground disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {testing && <Loader2 className="w-3 h-3 animate-spin" />}
              {t.addConnector.testConnection}
            </button>
            <button
              onClick={handleRegister}
              disabled={registering || !isValid}
              className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {registering && <Loader2 className="w-3 h-3 animate-spin" />}
              {t.addConnector.register}
            </button>
          </div>
        </div>
      </Card>
    </>
  );
}
