// Expose a single DTR submodel to the EDC catalog.
// Orchestrates (provider-side): create Asset (cx-taxo:SubmodelBundle) →
// create ContractDefinition (Offering) → link the DTR submodel descriptor's
// endpoint (subprotocolBody=id=<assetId>;dspEndpoint=<dsp>, href=data plane).
// Reuses existing connector-scoped services + SubmodelForm helpers.

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { useConnectorStore } from "@/stores/connectorStore";
import { createAsset, createOffering, fetchPolicies, fetchShellRaw, updateSubmodel } from "@/services";
import { rawSubmodelToInput, submodelInputToBody, newEndpoint } from "@/components/SubmodelForm";
import { FormField } from "@/components/ui-kmx";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Share2, AlertCircle } from "lucide-react";
import { toast } from "sonner";

export interface ExposeTarget {
  aasId: string;
  submodelId: string;
  idShort: string;
  semanticId: string;
}

const inputCls =
  "w-full px-2 py-1.5 text-[12px] border border-border rounded bg-card text-foreground placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-primary";

export function ExposeSubmodelDialog({
  target,
  onClose,
  onDone,
}: {
  target: ExposeTarget | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const connector = useConnectorStore((s) => s.connector);
  const connectorId = connector?.id;
  const open = !!target;

  const [assetId, setAssetId] = useState("");
  const [dataSourceUrl, setDataSourceUrl] = useState("");
  const [dataPlaneHref, setDataPlaneHref] = useState("");
  const [accessPolicyId, setAccessPolicyId] = useState("");
  const [contractPolicyId, setContractPolicyId] = useState("");
  const [busy, setBusy] = useState(false);

  // Reset form whenever a new submodel is targeted.
  useEffect(() => {
    if (target) {
      setAssetId(target.submodelId);
      setDataSourceUrl("");
      setDataPlaneHref("");
      setAccessPolicyId("");
      setContractPolicyId("");
    }
  }, [target]);

  const { data: policies = [], isLoading: polLoading } = useQuery({
    queryKey: ["policies", connectorId],
    queryFn: () => fetchPolicies(connectorId!),
    enabled: open && !!connectorId,
  });

  // Default the policy selects to the first available policy.
  useEffect(() => {
    if (policies.length > 0) {
      setAccessPolicyId((prev) => prev || policies[0].id);
      setContractPolicyId((prev) => prev || policies[0].id);
    }
  }, [policies]);

  const handleSubmit = async () => {
    if (!target) return;
    if (!connectorId) {
      toast.error(t.twins.expose.noConnector);
      return;
    }
    if (!assetId.trim() || !dataSourceUrl.trim() || !accessPolicyId || !contractPolicyId) {
      toast.error(t.twins.expose.requiredFields);
      return;
    }
    const aid = assetId.trim();
    setBusy(true);
    try {
      // 1) EDC Asset (SubmodelBundle) — data source behind the connector's data plane.
      await createAsset(
        {
          id: aid,
          name: target.idShort || aid,
          type: "cx-taxo:SubmodelBundle",
          sem: target.semanticId || "",
          aasId: target.aasId,
          submodelId: target.submodelId,
          dataAddressType: "HttpData",
          baseUrl: dataSourceUrl.trim(),
          proxyPath: "true",
          contentType: "application/json",
        },
        connectorId,
      );
    } catch (e) {
      setBusy(false);
      toast.error(`${t.twins.expose.failAsset}: ${(e as Error).message}`);
      return;
    }
    try {
      // 2) ContractDefinition (Offering) — makes the asset appear in the catalog.
      await createOffering(
        { id: `${aid}-cd`, asset: aid, access: accessPolicyId, contract: contractPolicyId },
        connectorId,
      );
    } catch (e) {
      setBusy(false);
      toast.error(`${t.twins.expose.failOffering}: ${(e as Error).message}`);
      return;
    }
    try {
      // 3) Link the DTR submodel descriptor's endpoint to the EDC asset.
      const raw = await fetchShellRaw(target.aasId);
      const subs = (raw?.submodelDescriptors as Array<Record<string, unknown>>) ?? [];
      const rawSub = subs.find((s) => (s.id as string) === target.submodelId);
      if (rawSub) {
        const input = rawSubmodelToInput(rawSub);
        if (input.endpoints.length === 0) input.endpoints = [newEndpoint()];
        const pi = input.endpoints[0].protocolInformation;
        pi.subprotocol = "DSP";
        pi.dspAssetId = aid;
        pi.dspEndpoint = connector?.dspEndpoint ?? "";
        pi.href = dataPlaneHref.trim() || dataSourceUrl.trim();
        await updateSubmodel(target.aasId, target.submodelId, submodelInputToBody(input));
      }
    } catch (e) {
      setBusy(false);
      toast.error(`${t.twins.expose.failLink}: ${(e as Error).message}`);
      return;
    }
    setBusy(false);
    toast.success(t.twins.expose.success);
    onDone();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[14px]">
            <Share2 className="w-4 h-4 text-primary" />
            {t.twins.expose.title}
          </DialogTitle>
        </DialogHeader>

        {!connectorId ? (
          <div className="flex items-start gap-2 text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{t.twins.expose.noConnector}</span>
          </div>
        ) : (
          <div className="space-y-2.5 text-[12px]">
            <p className="text-muted-foreground leading-snug">{t.twins.expose.desc}</p>
            <div className="text-[11px] text-muted-foreground">
              {t.twins.expose.connector}: <span className="font-medium text-foreground">{connector?.name}</span>
              {target?.idShort ? ` · ${target.idShort}` : ""}
            </div>

            <FormField label="Asset ID">
              <input className={`${inputCls} mono`} value={assetId} onChange={(e) => setAssetId(e.target.value)} />
            </FormField>
            <FormField label={t.twins.expose.dataSourceUrl} hint={t.twins.expose.dataSourceHint}>
              <input className={`${inputCls} mono`} placeholder="https://backend/submodel/data" value={dataSourceUrl} onChange={(e) => setDataSourceUrl(e.target.value)} />
            </FormField>
            <FormField label={t.twins.expose.dataPlaneHref} hint={t.twins.expose.dataPlaneHrefHint}>
              <input className={`${inputCls} mono`} placeholder={dataSourceUrl || "https://provider-dataplane/public/..."} value={dataPlaneHref} onChange={(e) => setDataPlaneHref(e.target.value)} />
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

            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={onClose}
                disabled={busy}
                className="text-[12px] px-3 py-1.5 rounded border border-border hover:bg-muted disabled:opacity-60"
              >
                {t.common.cancel}
              </button>
              <button
                onClick={handleSubmit}
                disabled={busy || policies.length === 0}
                className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded bg-primary hover:bg-primary/90 text-primary-foreground font-medium disabled:opacity-60"
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Share2 className="w-3.5 h-3.5" />}
                {busy ? t.twins.expose.submitting : t.twins.expose.submit}
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
