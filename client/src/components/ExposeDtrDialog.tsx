// Expose the Digital Twin Registry (DTR) itself to the EDC catalog.
// Standard Catena-X discovery pattern: the DTR endpoint becomes ONE EDC asset
// of type cx-taxo:DigitalTwinRegistry + a contract definition. A consumer
// discovers it in the provider catalog, negotiates, gets an EDR, then queries
// the DTR through the data plane to discover all registered twins.
// Reuses connector-scoped services (createAsset + createOffering); no shell wiring.

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { useConnectorStore } from "@/stores/connectorStore";
import { fetchConnectors, createAsset, createOffering, fetchPolicies } from "@/services";
import { FormField } from "@/components/ui-kmx";
import { SlidePanel } from "@/components/DetailDeleteDialogs";
import { Loader2, Share2, AlertCircle, X } from "lucide-react";
import { toast } from "sonner";

const inputCls =
  "w-full px-2 py-1.5 text-[12px] border border-border rounded bg-card text-foreground placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-primary";

const DTR_URL_DEFAULT = "http://platform-dtr:4243/semantics/registry/api/v3";

export function ExposeDtrDialog({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const storeConnector = useConnectorStore((s) => s.connector);

  const [connectorId, setConnectorId] = useState("");
  const [assetId, setAssetId] = useState("");
  const [dtrUrl, setDtrUrl] = useState("");
  const [accessPolicyId, setAccessPolicyId] = useState("");
  const [contractPolicyId, setContractPolicyId] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: connectors = [] } = useQuery({
    queryKey: ["connectors"],
    queryFn: fetchConnectors,
    enabled: open,
  });
  const connector = connectors.find((c) => c.id === connectorId);

  // Init on open: prefill DTR URL; default connector = store selection or first.
  useEffect(() => {
    if (open) {
      setDtrUrl(DTR_URL_DEFAULT);
      setAccessPolicyId("");
      setContractPolicyId("");
      setConnectorId(storeConnector?.id ?? "");
    }
  }, [open, storeConnector?.id]);

  // Default connector to the first available once the list loads.
  useEffect(() => {
    if (open && !connectorId && connectors.length > 0) setConnectorId(connectors[0].id);
  }, [open, connectorId, connectors]);

  // Asset ID default tracks the selected connector's BPN.
  useEffect(() => {
    if (open) setAssetId(connector?.bpn ? `dtr-${connector.bpn}` : "digital-twin-registry");
  }, [open, connector?.bpn]);

  const { data: policies = [], isLoading: polLoading } = useQuery({
    queryKey: ["policies", connectorId],
    queryFn: () => fetchPolicies(connectorId),
    enabled: open && !!connectorId,
  });

  useEffect(() => {
    if (policies.length > 0) {
      setAccessPolicyId((prev) => prev || policies[0].id);
      setContractPolicyId((prev) => prev || policies[0].id);
    }
  }, [policies]);

  const handleSubmit = async () => {
    if (!connectorId) { toast.error(t.twins.expose.needConnector); return; }
    if (!assetId.trim()) { toast.error(t.twins.exposeDtr.requiredFields); return; }
    if (!dtrUrl.trim()) { toast.error(t.twins.exposeDtr.needUrl); return; }
    if (!accessPolicyId || !contractPolicyId) { toast.error(t.twins.expose.needPolicies); return; }
    const aid = assetId.trim();
    setBusy(true);
    try {
      await createAsset(
        {
          id: aid,
          name: "Digital Twin Registry",
          type: "cx-taxo:DigitalTwinRegistry",
          dataAddressType: "HttpData",
          baseUrl: dtrUrl.trim(),
          proxyPath: "true",
          proxyQueryParams: "true",
          contentType: "application/json",
        },
        connectorId,
      );
    } catch (e) {
      setBusy(false);
      toast.error(`${t.twins.exposeDtr.failAsset}: ${(e as Error).message}`);
      return;
    }
    try {
      await createOffering(
        { id: `${aid}-cd`, asset: aid, access: accessPolicyId, contract: contractPolicyId },
        connectorId,
      );
    } catch (e) {
      setBusy(false);
      toast.error(`${t.twins.exposeDtr.failOffering}: ${(e as Error).message}`);
      return;
    }
    setBusy(false);
    toast.success(t.twins.exposeDtr.success);
    onDone();
    onClose();
  };

  return (
    <SlidePanel open={open} onClose={() => { if (!busy) onClose(); }} className="max-w-xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border bg-muted/30 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Share2 className="w-4 h-4 text-primary flex-shrink-0" />
          <p className="font-display text-[14px] font-bold text-foreground truncate">{t.twins.exposeDtr.title}</p>
        </div>
        <button
          onClick={onClose}
          disabled={busy}
          aria-label={t.common.close}
          className="p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 disabled:opacity-50"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 text-[12px]">
        <p className="text-muted-foreground leading-snug">{t.twins.exposeDtr.desc}</p>

        {connectors.length === 0 ? (
          <div className="flex items-start gap-2 text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{t.twins.expose.noConnectors}</span>
          </div>
        ) : (
          <>
            <FormField label={t.twins.expose.selectConnector}>
              <select className={inputCls} value={connectorId} onChange={(e) => setConnectorId(e.target.value)}>
                {connectors.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.bpn}</option>)}
              </select>
            </FormField>

            <FormField label="Asset ID">
              <input className={`${inputCls} mono`} value={assetId} onChange={(e) => setAssetId(e.target.value)} />
            </FormField>
            <FormField label={t.twins.exposeDtr.dtrUrl} hint={t.twins.exposeDtr.dtrUrlHint}>
              <input className={`${inputCls} mono`} placeholder={DTR_URL_DEFAULT} value={dtrUrl} onChange={(e) => setDtrUrl(e.target.value)} />
            </FormField>

            {policies.length === 0 && !polLoading ? (
              <div className="flex items-start gap-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span>{t.twins.expose.noPolicies}</span>
              </div>
            ) : (
              <div className="flex gap-2">
                <div className="flex-1 min-w-0">
                  <FormField label={t.twins.expose.accessPolicy}>
                    <select className={inputCls} value={accessPolicyId} onChange={(e) => setAccessPolicyId(e.target.value)}>
                      {policies.map((p) => <option key={p.id} value={p.id}>{p.id}</option>)}
                    </select>
                  </FormField>
                </div>
                <div className="flex-1 min-w-0">
                  <FormField label={t.twins.expose.contractPolicy}>
                    <select className={inputCls} value={contractPolicyId} onChange={(e) => setContractPolicyId(e.target.value)}>
                      {policies.map((p) => <option key={p.id} value={p.id}>{p.id}</option>)}
                    </select>
                  </FormField>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="flex justify-end gap-2 px-3 py-2.5 border-t border-border bg-muted/20 flex-shrink-0">
        <button onClick={onClose} disabled={busy} className="text-[12px] px-3 py-1.5 rounded border border-border hover:bg-muted disabled:opacity-60">
          {t.common.cancel}
        </button>
        <button
          onClick={handleSubmit}
          disabled={busy || connectors.length === 0 || policies.length === 0}
          className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded bg-primary hover:bg-primary/90 text-primary-foreground font-medium disabled:opacity-60"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Share2 className="w-3.5 h-3.5" />}
          {busy ? t.twins.exposeDtr.submitting : t.twins.exposeDtr.submit}
        </button>
      </div>
    </SlidePanel>
  );
}
