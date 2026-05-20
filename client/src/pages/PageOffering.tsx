// Connector Hub — Data Offering Page (spec 4.4)
// 4-step wizard: Asset selection → Access policy → Contract policy → Publish
// Responsive table↔card, sticky wizard nav on mobile

import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { fetchOfferings, fetchAssets, fetchPolicies, fetchNegotiations, createOffering, updateOffering, deleteOffering } from "@/services";
import { type Asset, type Policy, type Offering } from "@/lib/data";
import { useConnectorStore } from "@/stores/connectorStore";
import { DetailDialog, DeleteConfirmDialog, ConfirmActionDialog, JsonViewerDialog } from "@/components/DetailDeleteDialogs";
import { Pagination, paginate } from "@/components/Pagination";
import { Card, Badge, MonoText, SectionHdr, Stepper, FormField } from "@/components/ui-kmx";
import { PlusCircle, Copy, Search, Loader2, RefreshCw, AlertCircle, Database, Shield, X, Code, CheckCircle2 } from "lucide-react";
import { RoleGate } from "@/components/RoleGate";
import { toast } from "sonner";

const EDC_NS_ID = "https://w3id.org/edc/v0.0.1/ns/id";

interface PageOfferingProps {
  onNav: (path: string) => void;
}

export default function PageOffering({ onNav }: PageOfferingProps) {
  const { t } = useI18n();
  const connector = useConnectorStore((s) => s.connector);
  const connectorId = connector?.id;
  const [tab, setTab] = useState<"list" | "wizard">("list");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [detailTarget, setDetailTarget] = useState<Offering | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Offering | null>(null);
  const [wizardDirty, setWizardDirty] = useState(false);
  const [pendingTabSwitch, setPendingTabSwitch] = useState<"list" | null>(null);
  const [editTarget, setEditTarget] = useState<Offering | null>(null);
  const [duplicateSource, setDuplicateSource] = useState<Offering | null>(null);
  const [jsonTarget, setJsonTarget] = useState<Offering | null>(null);

  const { data: offerings = [], isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["offerings", connectorId],
    queryFn: () => fetchOfferings(connectorId!),
    enabled: !!connectorId,
  });

  const { data: assets = [] } = useQuery({
    queryKey: ["assets", connectorId],
    queryFn: () => fetchAssets(connectorId!),
    enabled: !!connectorId,
  });

  const { data: policies = [] } = useQuery({
    queryKey: ["policies", connectorId],
    queryFn: () => fetchPolicies(connectorId!),
    enabled: !!connectorId,
  });

  const { data: negotiations = [] } = useQuery({
    queryKey: ["negotiations", connectorId],
    queryFn: () => fetchNegotiations(connectorId!),
    enabled: !!connectorId,
  });

  const switchTab = (next: "list" | "wizard") => {
    if (next === "list" && tab === "wizard" && wizardDirty) {
      setPendingTabSwitch("list");
      return;
    }
    setTab(next);
  };

  const filtered = offerings.filter(
    (o) =>
      (o.id ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (o.asset ?? "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <>
      <SectionHdr
        breadcrumb={connector ? `${connector.name} / ${connector.bpn}` : undefined}
        action={
          <RoleGate permission="resource:write">
            <button
              onClick={() => switchTab("wizard")}
              className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded bg-primary hover:bg-primary/90 text-primary-foreground font-medium transition-colors"
            >
              <PlusCircle className="w-3 h-3" />
              {t.offerings.createWizard}
            </button>
          </RoleGate>
        }
      >{t.offerings.title}</SectionHdr>

      {/* Tabs */}
      <div className="flex border-b border-border -mt-1">
        <button
          onClick={() => switchTab("list")}
          className={`px-4 py-2 text-[12px] border-b-2 transition-colors -mb-px ${
            tab === "list"
              ? "border-primary text-primary font-medium"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          {t.offerings.list}
        </button>
        <RoleGate permission="resource:write">
          <button
            onClick={() => switchTab("wizard")}
            className={`px-4 py-2 text-[12px] border-b-2 transition-colors -mb-px ${
              tab === "wizard"
                ? "border-primary text-primary font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.offerings.wizard}
          </button>
        </RoleGate>
      </div>

      {tab === "list" && (
        <>
          {/* Search */}
          <div className="flex gap-2">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input
                type="text"
                placeholder={t.offerings.searchPlaceholder}
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                className="w-full pl-8 pr-3 py-1.5 text-[12px] border border-border rounded-md bg-card focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          {/* Loading state */}
          {isLoading && (
            <Card>
              <div className="flex items-center justify-center py-10 gap-2 text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-[13px]">{t.common.loading}</span>
              </div>
            </Card>
          )}

          {/* Error state */}
          {!isLoading && isError && (
            <Card>
              <div className="flex flex-col items-center justify-center py-10 gap-3">
                <div className="flex items-center gap-2 text-rose-600">
                  <AlertCircle className="w-4 h-4" />
                  <span className="text-[13px] font-medium">{t.common.loadFailed}</span>
                </div>
                <button
                  onClick={() => refetch()}
                  disabled={isFetching}
                  className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-md border border-border hover:bg-muted text-foreground/80 disabled:opacity-50"
                >
                  <RefreshCw className={`w-3 h-3 ${isFetching ? "animate-spin" : ""}`} />
                  {t.common.retry}
                </button>
              </div>
            </Card>
          )}

          {/* Desktop/Tablet: Table */}
          {!isLoading && !isError && (
          <Card noPad className="hidden md:block">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-muted/50 border-b border-border">
                  <tr>
                    {[t.offerings.offeringId, t.offerings.step1, t.offerings.step2, t.offerings.step3, t.offerings.contractCount].map((h) => (
                      <th key={h} className="text-left !text-[12px] px-4 py-3 whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {paginate(filtered, page).map((o) => (
                    <tr key={o.id} onClick={() => setDetailTarget(o)} className="hover:bg-muted/30 transition-colors group cursor-pointer">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <MonoText className="!text-[12px] !font-normal">{o.id}</MonoText>
                          <button
                            onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(o.id); toast.success(t.common.copied); }}
                            className="opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <Copy className="w-3 h-3 text-muted-foreground hover:text-foreground" />
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="!text-[12px] font-normal text-foreground/80">{o.asset || "—"}</span>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="purple" className="text-[11px]">{o.access || "—"}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="purple" className="text-[11px]">{o.contract || "—"}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <span className="!text-[12px] font-normal text-foreground">{o.cnt}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filtered.length === 0 && (
              <div className="text-center py-8 text-muted-foreground text-[12px]">{t.common.noResults}</div>
            )}
            <div className="px-4 pb-3">
              <Pagination total={filtered.length} page={page} onPageChange={setPage} />
            </div>
          </Card>
          )}

          {/* Mobile: Card Stack */}
          {!isLoading && !isError && (
          <div className="md:hidden flex flex-col gap-3">
            {paginate(filtered, page).map((o) => (
              <div key={o.id} onClick={() => setDetailTarget(o)} className="cursor-pointer"><OfferingCard offering={o} /></div>
            ))}
            {filtered.length === 0 && (
              <div className="text-center py-8 text-muted-foreground text-[12px]">{t.common.noResults}</div>
            )}
          </div>
          )}
        </>
      )}

      {tab === "wizard" && connectorId && (
        <OfferingWizard
          key={(editTarget?.id ?? "") + "|" + (duplicateSource?.id ?? "") + "|" + (editTarget ? "e" : duplicateSource ? "d" : "n")}
          assets={assets}
          policies={policies}
          connectorId={connectorId}
          existingOfferingIds={offerings.map((o) => o.id)}
          editTarget={editTarget}
          duplicateSource={duplicateSource}
          onDirtyChange={setWizardDirty}
          onDone={() => { setWizardDirty(false); setEditTarget(null); setDuplicateSource(null); setTab("list"); }}
          onCancel={() => { setWizardDirty(false); setEditTarget(null); setDuplicateSource(null); setTab("list"); }}
        />
      )}

      {/* JSON Viewer */}
      {jsonTarget && <OfferingJsonDialog offering={jsonTarget} onClose={() => setJsonTarget(null)} />}

      {/* Unsaved changes confirmation */}
      <ConfirmActionDialog
        open={!!pendingTabSwitch}
        onClose={() => setPendingTabSwitch(null)}
        title={t.common.unsavedChanges}
        description={t.common.unsavedChangesDesc}
        tone="warn"
        cancelLabel={t.common.stay}
        confirmLabel={t.common.leave}
        onConfirm={() => { if (pendingTabSwitch) { setWizardDirty(false); setTab(pendingTabSwitch); setPendingTabSwitch(null); } }}
      />

      {detailTarget && (() => {
        const accessP = policies.find((p) => p.id === detailTarget.access);
        const contractP = policies.find((p) => p.id === detailTarget.contract);
        const assetIds = (detailTarget.asset ?? "").split(",").map((s) => s.trim()).filter(Boolean);
        const relatedNegs = negotiations.filter((n) => n.assetId && assetIds.includes(n.assetId)).slice(0, 5);
        const accessDeleted = !!detailTarget.access && !accessP;
        const contractDeleted = !!detailTarget.contract && !contractP;
        const accessFields: { label: string; value: string; mono?: boolean; copyable?: boolean; badge?: { text: string; variant: string } }[] = [
          { label: t.policies.col.id, value: detailTarget.access, mono: true, copyable: true },
        ];
        if (accessDeleted) accessFields.push({ label: t.offerings.policyStatus, value: "", badge: { text: t.offerings.policyDeleted, variant: "red" } });
        else accessFields.push({ label: t.policies.constraints, value: accessP?.constraint || "—", mono: true });
        const contractFields: typeof accessFields = [
          { label: t.policies.col.id, value: detailTarget.contract, mono: true, copyable: true },
        ];
        if (contractDeleted) contractFields.push({ label: t.offerings.policyStatus, value: "", badge: { text: t.offerings.policyDeleted, variant: "red" } });
        else contractFields.push({ label: t.policies.constraints, value: contractP?.constraint || "—", mono: true });
        return (
          <DetailDialog
            open={!!detailTarget}
            onClose={() => setDetailTarget(null)}
            title={detailTarget.id}
            subtitle={`${t.offerings.contractCount}: ${detailTarget.cnt}  ·  ${t.offerings.assetCount(assetIds.length)}`}
            subtitleMono={false}
            sections={[
              {
                title: t.offerings.col.asset,
                fields: assetIds.length === 0
                  ? [{ label: t.assets.col.id, value: detailTarget.asset, mono: true, copyable: true }]
                  : assetIds.map((id, i) => ({ label: assetIds.length > 1 ? `#${i + 1}` : t.assets.col.id, value: id, mono: true, copyable: true })),
              },
              {
                title: t.offerings.col.access,
                fields: accessFields,
              },
              {
                title: t.offerings.col.contract,
                fields: contractFields,
              },
              {
                title: t.offerings.col.cnt,
                fields: [
                  { label: t.offerings.contractCount, value: "", badge: { text: `${detailTarget.cnt}`, variant: detailTarget.cnt > 0 ? "blue" : "gray" } },
                ],
              },
              {
                title: t.offerings.relatedNegotiations,
                fields: relatedNegs.length === 0
                  ? [{ label: "", value: t.offerings.noRelatedNegotiations }]
                  : relatedNegs.map((n) => ({
                      label: n.name,
                      value: `${n.id.slice(0, 12)}…  ·  ${n.peer}  ·  ${n.ts}`,
                      mono: true,
                    })),
              },
            ]}
            onEdit={() => { setEditTarget(detailTarget); setDetailTarget(null); setTab("wizard"); }}
            onDuplicate={() => { setDuplicateSource(detailTarget); setDetailTarget(null); setTab("wizard"); }}
            onShowJson={() => { setJsonTarget(detailTarget); setDetailTarget(null); }}
            onDelete={detailTarget.cnt > 0 ? undefined : () => { setDeleteTarget(detailTarget); setDetailTarget(null); }}
            deleteDisabledReason={detailTarget.cnt > 0 ? t.offerings.deleteBlockedByContracts(detailTarget.cnt) : undefined}
          />
        );
      })()}

      {deleteTarget && connectorId && (
        <DeleteConfirmDialog
          open={!!deleteTarget}
          onClose={() => setDeleteTarget(null)}
          itemName={deleteTarget.id}
          onConfirm={() => deleteOffering(deleteTarget.id, connectorId)}
          queryKeys={[["offerings", connectorId], ["policies", connectorId], ["assets", connectorId]]}
        />
      )}
    </>
  );
}

/* ─── Offering Card (Mobile) ─────────────────────────────────── */
function OfferingCard({ offering: o }: { offering: Offering }) {
  const { t } = useI18n();
  return (
    <div className="bg-card rounded-xl p-3 shadow-sm border border-border">
      <div className="flex items-center justify-between mb-2">
        <MonoText className="text-[12px] font-medium">{o.id}</MonoText>
        <button onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(o.id); toast.success(t.common.copied); }}>
          <Copy className="w-3 h-3 text-muted-foreground" />
        </button>
      </div>
      <div className="text-[12px] text-foreground/80 mb-1.5">{o.asset || "—"}</div>
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <Badge variant="purple" className="text-[11px]">{o.access || "—"}</Badge>
        <Badge variant="purple" className="text-[11px]">{o.contract || "—"}</Badge>
        <span className="ml-auto font-semibold text-foreground">{o.cnt}</span>
      </div>
    </div>
  );
}

/* ─── Offering Creation Wizard (spec 4.4 — 4 steps) ─────────── */
function OfferingWizard({
  assets,
  policies,
  connectorId,
  existingOfferingIds = [],
  editTarget,
  duplicateSource,
  onDone,
  onCancel,
  onDirtyChange,
}: {
  assets: Asset[];
  policies: Policy[];
  connectorId: string;
  existingOfferingIds?: string[];
  editTarget?: Offering | null;
  duplicateSource?: Offering | null;
  onDone: () => void;
  onCancel?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const isEdit = !!editTarget;
  const baseSrc: Offering | null = editTarget ?? duplicateSource ?? null;
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const steps = [t.offerings.step1, t.offerings.step2, t.offerings.step3, t.offerings.step4];

  // Wizard state — prefill from base source if editing/duplicating
  const initialAssets: string[] = baseSrc?.asset ? baseSrc.asset.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const initialId = editTarget ? editTarget.id : duplicateSource ? `${duplicateSource.id}-copy` : "";
  const [selAssets, setSelAssets] = useState<string[]>(initialAssets);
  const [accessPolicy, setAccessPolicy] = useState(baseSrc?.access ?? policies[0]?.id ?? "");
  const [contractPolicy, setContractPolicy] = useState(baseSrc?.contract ?? policies[0]?.id ?? "");
  const [offeringId, setOfferingId] = useState(initialId);
  const [offeringIdError, setOfferingIdError] = useState<string | null>(null);
  const [assetSearch, setAssetSearch] = useState("");
  const [policySearch, setPolicySearch] = useState("");

  const filteredAssets = assets.filter((a) => {
    const q = assetSearch.toLowerCase();
    return !q || (a.id ?? "").toLowerCase().includes(q) || (a.name ?? "").toLowerCase().includes(q) || (a.type ?? "").toLowerCase().includes(q);
  });
  const filteredPolicies = policies.filter((p) => {
    const q = policySearch.toLowerCase();
    return !q || (p.id ?? "").toLowerCase().includes(q) || (p.constraint ?? "").toLowerCase().includes(q);
  });

  // Reset dirty flag when target changes
  useEffect(() => { onDirtyChange?.(false); }, [editTarget?.id, duplicateSource?.id, onDirtyChange]);

  const markDirty = () => { onDirtyChange?.(true); };

  const validateOfferingId = (id: string): string | null => {
    if (!id.trim()) return t.offerings.offeringIdRequired;
    if (id.length > 128) return t.offerings.idTooLong;
    if (/\s/.test(id)) return t.offerings.idNoSpaces;
    if (/[/?#%&]/.test(id)) return t.offerings.idInvalidChars;
    if (!isEdit && existingOfferingIds.includes(id)) return t.offerings.idDuplicate;
    return null;
  };

  const toggleAsset = (id: string) => {
    setSelAssets((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
    markDirty();
  };

  const assetsSelectorJson =
    selAssets.length > 0
      ? JSON.stringify(
          {
            "@type": "CriterionDto",
            operandLeft: EDC_NS_ID,
            operator: "in",
            operandRight: selAssets,
          },
          null,
          2
        )
      : null;

  const handlePublish = async () => {
    const idErr = validateOfferingId(offeringId);
    if (idErr) { setOfferingIdError(idErr); toast.error(idErr); return; }
    setSubmitting(true);
    try {
      const payload = {
        id: offeringId,
        asset: selAssets.join(","),
        access: accessPolicy,
        contract: contractPolicy,
      };
      if (isEdit) {
        await updateOffering(offeringId, payload as Record<string, unknown>, connectorId);
        toast.success(t.offerings.updated);
      } else {
        await createOffering(payload, connectorId);
        toast.success(t.offerings.published);
      }
    } catch {
      toast.error(isEdit ? t.offerings.updateFailed : t.offerings.publishFailed);
      setSubmitting(false);
      return;
    }
    try {
      await queryClient.refetchQueries({ queryKey: ["offerings", connectorId] });
      queryClient.invalidateQueries({ queryKey: ["policies", connectorId] });
      queryClient.invalidateQueries({ queryKey: ["assets", connectorId] });
    } catch {}
    setSubmitting(false);
    onDone();
  };

  return (
    <Card
      title={isEdit ? t.offerings.editWizard : duplicateSource ? t.offerings.duplicateWizard : t.offerings.createWizard}
      actions={onCancel ? (
        <button
          onClick={onCancel}
          className="text-[11px] px-2 py-1 rounded border border-border hover:bg-muted text-muted-foreground"
        >
          {t.common.cancel}
        </button>
      ) : undefined}
    >
      {/* Stepper: horizontal on sm+, text on mobile */}
      <div className="hidden sm:block">
        <Stepper steps={steps} current={step} />
      </div>
      <div className="sm:hidden text-[12px] text-muted-foreground mb-3 font-medium">
        {t.offerings.stepMobile(step + 1, steps.length, steps[step])}
      </div>

      {/* Step 1: Asset Selection */}
      {step === 0 && (
        <div className="space-y-3">
          <div className="mb-1">
            <div className="text-[12px] font-semibold text-muted-foreground">{t.offerings.step1}</div>
            <div className="h-px bg-border mt-1.5" />
          </div>

          {assets.length === 0 && (
            <div className="flex flex-col items-center justify-center py-8 gap-3 bg-muted/30 rounded-md border border-dashed border-border">
              <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
                <Database className="w-5 h-5 text-blue-400" />
              </div>
              <div className="text-center">
                <p className="text-[13px] font-semibold text-foreground/80">{t.offerings.noAssetsTitle}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{t.offerings.noAssetsDesc}</p>
              </div>
              <button
                onClick={() => navigate(`/connectors/${connectorId}/assets`)}
                className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-md bg-primary hover:bg-primary/90 text-primary-foreground font-medium"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                {t.offerings.goToAssets}
              </button>
            </div>
          )}

          {assets.length > 0 && (
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input
                type="text"
                placeholder={t.offerings.searchAssetPlaceholder}
                value={assetSearch}
                onChange={(e) => setAssetSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-[12px] border border-border rounded-md bg-card focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          )}

          {filteredAssets.map((a) => {
            const isSelected = selAssets.includes(a.id);
            return (
              <button
                key={a.id}
                onClick={() => toggleAsset(a.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md border transition-all text-left ${
                  isSelected
                    ? "border-primary bg-primary/10"
                    : "border-border bg-muted hover:border-primary/50"
                }`}
              >
                <div
                  className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                    isSelected
                      ? "bg-primary border-primary"
                      : "border-border bg-card"
                  }`}
                >
                  {isSelected && (
                    <span className="text-primary-foreground text-[11px]">&#10003;</span>
                  )}
                </div>
                <MonoText className={`flex-1 text-[11px] ${isSelected ? "text-primary" : ""}`}>{a.id}</MonoText>
                <Badge variant="gray">{a.type}</Badge>
              </button>
            );
          })}

          {assetsSelectorJson && (
            <div className="mt-2">
              <div className="text-[11px] font-medium text-muted-foreground mb-2 uppercase tracking-wide">
                {t.offerings.assetsSelector}
              </div>
              <pre className="mono text-[12px] bg-slate-900 text-slate-300 rounded-lg p-3 overflow-auto whitespace-pre-wrap leading-relaxed">
                {assetsSelectorJson}
              </pre>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 sm:static fixed bottom-14 left-0 right-0 sm:bg-transparent bg-card sm:p-0 p-3 sm:border-0 border-t border-border z-30">
            <button
              onClick={() => setStep(1)}
              disabled={selAssets.length === 0}
              className="text-[12px] px-3 py-1.5 rounded bg-primary hover:bg-primary/90 text-primary-foreground font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed w-full sm:w-auto"
            >
              {t.offerings.step2} &rarr;
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Access Policy */}
      {step === 1 && (
        <div className="space-y-3">
          <div className="mb-1">
            <div className="text-[12px] font-semibold text-muted-foreground">{t.offerings.step2}</div>
            <div className="h-px bg-border mt-1.5" />
          </div>
          <div className="bg-sky-50 border border-sky-200 rounded-md px-3 py-2 text-[11px] text-sky-800">
            {t.offerings.whoCanSee}
          </div>
          {policies.length === 0 ? (
            <NoPoliciesHint connectorId={connectorId} navigate={navigate} t={t} />
          ) : (
            <>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <input
                  type="text"
                  placeholder={t.offerings.searchPolicyPlaceholder}
                  value={policySearch}
                  onChange={(e) => setPolicySearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-[12px] border border-border rounded-md bg-card focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <PolicySelector
                policies={filteredPolicies}
                selected={accessPolicy}
                onSelect={(id) => { setAccessPolicy(id); markDirty(); }}
              />
            </>
          )}
          <div className="flex justify-end gap-2 pt-2 sm:static fixed bottom-14 left-0 right-0 sm:bg-transparent bg-card sm:p-0 p-3 sm:border-0 border-t border-border z-30">
            <button
              onClick={() => setStep(0)}
              className="text-[12px] px-3 py-1.5 rounded border border-border hover:bg-muted transition-colors text-muted-foreground"
            >
              {t.common.prev}
            </button>
            <button
              onClick={() => setStep(2)}
              disabled={!accessPolicy}
              className="text-[12px] px-3 py-1.5 rounded bg-primary hover:bg-primary/90 text-primary-foreground font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex-1 sm:flex-initial"
            >
              {t.offerings.step3} &rarr;
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Contract Policy */}
      {step === 2 && (
        <div className="space-y-3">
          <div className="mb-1">
            <div className="text-[12px] font-semibold text-muted-foreground">{t.offerings.step3}</div>
            <div className="h-px bg-border mt-1.5" />
          </div>
          <div className="bg-violet-50 border border-violet-200 rounded-md px-3 py-2 text-[11px] text-violet-800">
            {t.offerings.whoCanContract}
          </div>
          {policies.length === 0 ? (
            <NoPoliciesHint connectorId={connectorId} navigate={navigate} t={t} />
          ) : (
            <>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <input
                  type="text"
                  placeholder={t.offerings.searchPolicyPlaceholder}
                  value={policySearch}
                  onChange={(e) => setPolicySearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-[12px] border border-border rounded-md bg-card focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <PolicySelector
                policies={filteredPolicies}
                selected={contractPolicy}
                onSelect={(id) => { setContractPolicy(id); markDirty(); }}
              />
            </>
          )}
          <div className="flex justify-end gap-2 pt-2 sm:static fixed bottom-14 left-0 right-0 sm:bg-transparent bg-card sm:p-0 p-3 sm:border-0 border-t border-border z-30">
            <button
              onClick={() => setStep(1)}
              className="text-[12px] px-3 py-1.5 rounded border border-border hover:bg-muted transition-colors text-muted-foreground"
            >
              {t.common.prev}
            </button>
            <button
              onClick={() => setStep(3)}
              disabled={!contractPolicy}
              className="text-[12px] px-3 py-1.5 rounded bg-primary hover:bg-primary/90 text-primary-foreground font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex-1 sm:flex-initial"
            >
              {t.offerings.step4} &rarr;
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Offering ID + Summary + Publish */}
      {step === 3 && (
        <div className="space-y-4">
          <div className="mb-1">
            <div className="text-[12px] font-semibold text-muted-foreground">{t.offerings.step4}</div>
            <div className="h-px bg-border mt-1.5" />
          </div>
          <FormField label={t.offerings.offeringId} required>
            <input
              value={offeringId}
              onChange={(e) => { setOfferingId(e.target.value); setOfferingIdError(null); markDirty(); }}
              placeholder="cd-id"
              disabled={isEdit}
              title={isEdit ? t.offerings.idImmutable : undefined}
              className="w-full text-[12px] px-2.5 py-1.5 border border-border rounded-md bg-muted focus:outline-none focus:ring-1 focus:ring-primary mono disabled:opacity-60 disabled:cursor-not-allowed"
            />
            {offeringIdError && (
              <div className="flex items-center gap-1 mt-1 text-[11px] text-rose-600">
                <AlertCircle className="w-3 h-3" /> {offeringIdError}
              </div>
            )}
          </FormField>

          {/* Summary panel */}
          <div className="bg-muted rounded-md p-3 space-y-2.5">
            <div className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wide">
              {t.common.confirm}
            </div>
            <div className="flex justify-between items-center text-[12px]">
              <span className="text-muted-foreground">{t.offerings.selectedAssets}</span>
              <span className="font-semibold">{t.offerings.count(selAssets.length)}</span>
            </div>
            {selAssets.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {selAssets.map((id) => (
                  <MonoText
                    key={id}
                    className="text-[11px] bg-card px-1.5 py-0.5 rounded border border-border"
                  >
                    {id}
                  </MonoText>
                ))}
              </div>
            )}
            <div className="flex justify-between items-center text-[12px]">
              <span className="text-muted-foreground">{t.offerings.step2}</span>
              <Badge variant="purple">{accessPolicy || "—"}</Badge>
            </div>
            <div className="flex justify-between items-center text-[12px]">
              <span className="text-muted-foreground">{t.offerings.step3}</span>
              <Badge variant="purple">{contractPolicy || "—"}</Badge>
            </div>
          </div>

          {assetsSelectorJson && (
            <div>
              <div className="text-[11px] font-medium text-muted-foreground mb-2 uppercase tracking-wide">
                {t.offerings.assetsSelector}
              </div>
              <pre className="mono text-[12px] bg-slate-900 text-slate-300 rounded-lg p-3 overflow-auto whitespace-pre-wrap leading-relaxed">
                {assetsSelectorJson}
              </pre>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 sm:static fixed bottom-14 left-0 right-0 sm:bg-transparent bg-card sm:p-0 p-3 sm:border-0 border-t border-border z-30">
            <button
              onClick={() => setStep(2)}
              className="text-[12px] px-3 py-1.5 rounded border border-border hover:bg-muted transition-colors text-muted-foreground"
            >
              {t.common.prev}
            </button>
            <button
              onClick={handlePublish}
              disabled={submitting}
              className="text-[12px] px-3 py-1.5 rounded bg-primary hover:bg-primary/90 text-primary-foreground font-medium transition-colors disabled:opacity-60 flex-1 sm:flex-initial"
            >
              {submitting ? t.offerings.publishing : isEdit ? t.common.save : t.offerings.publish}
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

/* ─── JSON Viewer (ContractDefinition) ───────────────────────── */
function OfferingJsonDialog({ offering, onClose }: { offering: Offering; onClose: () => void }) {
  const { t } = useI18n();
  const assetIds = (offering.asset ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const envelope = {
    "@context": { "@vocab": "https://w3id.org/edc/v0.0.1/ns/" },
    "@id": offering.id,
    "@type": "ContractDefinition",
    accessPolicyId: offering.access,
    contractPolicyId: offering.contract,
    assetsSelector: assetIds.length > 0 ? [{
      "@type": "CriterionDto",
      operandLeft: "https://w3id.org/edc/v0.0.1/ns/id",
      operator: "in",
      operandRight: assetIds,
    }] : [],
  };
  return (
    <JsonViewerDialog
      open={true}
      onClose={onClose}
      title={t.offerings.jsonTitle}
      subtitle={offering.id}
      json={JSON.stringify(envelope, null, 2)}
      downloadName={offering.id}
    />
  );
}

/* ─── No Policies Hint (Step 2/3) ────────────────────────────── */
function NoPoliciesHint({ connectorId, navigate, t }: { connectorId: string; navigate: (path: string) => void; t: ReturnType<typeof useI18n>["t"] }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 gap-3 bg-muted/30 rounded-md border border-dashed border-border">
      <div className="w-10 h-10 rounded-lg bg-violet-50 flex items-center justify-center">
        <Shield className="w-5 h-5 text-violet-400" />
      </div>
      <div className="text-center">
        <p className="text-[13px] font-semibold text-foreground/80">{t.offerings.noPoliciesTitle}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">{t.offerings.noPoliciesDesc}</p>
      </div>
      <button
        onClick={() => navigate(`/connectors/${connectorId}/policy`)}
        className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-md bg-primary hover:bg-primary/90 text-primary-foreground font-medium"
      >
        <PlusCircle className="w-3.5 h-3.5" />
        {t.offerings.goToPolicies}
      </button>
    </div>
  );
}

/* ─── Policy Selector with radio + detail panel ──────────────── */
function PolicySelector({
  policies,
  selected,
  onSelect,
}: {
  policies: Policy[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  const { t } = useI18n();
  const selectedPolicy = policies.find((p) => p.id === selected);

  const parseConstraint = (constraint: string) => {
    if (!constraint) return [];
    return constraint.split(/[;,]/).map((s) => s.trim()).filter(Boolean).map((part) => {
      const colonIdx = part.indexOf(":");
      if (colonIdx > -1) {
        return { left: part.substring(0, colonIdx).trim(), op: "eq", right: part.substring(colonIdx + 1).trim() };
      }
      return { left: part, op: "eq", right: "" };
    });
  };

  return (
    <div className="space-y-2">
      {policies.map((p) => {
        const isSelected = selected === p.id;
        return (
          <button
            key={p.id}
            onClick={() => onSelect(p.id)}
            className={`w-full flex items-start gap-3 px-3 py-2.5 rounded-md border transition-all text-left ${
              isSelected
                ? "border-primary bg-primary/10"
                : "border-border bg-card hover:border-primary/50"
            }`}
          >
            <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${
              isSelected ? "border-primary" : "border-border"
            }`}>
              {isSelected && <div className="w-2 h-2 rounded-full bg-primary" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <MonoText className={`text-[12px] font-medium ${isSelected ? "text-primary" : ""}`}>{p.id}</MonoText>
                <Badge variant="gray" className="text-[11px] flex-shrink-0">
                  {t.policies.offeringRef(p.offers)}
                </Badge>
              </div>
              <div className={`text-[11px] mt-0.5 ${isSelected ? "text-primary/80" : "text-muted-foreground"}`}>{p.constraint}</div>
            </div>
          </button>
        );
      })}

      {selectedPolicy && (
        <div className="bg-muted/50 border border-border rounded-lg p-3 space-y-3 mt-1">
          <div className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
            {t.policies.constraints}
          </div>
          <div className="space-y-1.5">
            {parseConstraint(selectedPolicy.constraint).map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <MonoText className="text-[11px] font-medium">{c.left}</MonoText>
                <Badge variant="amber">{c.op}</Badge>
                <MonoText className="text-[11px] text-muted-foreground">{c.right}</MonoText>
              </div>
            ))}
          </div>
          <div className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mt-2">
            ODRL JSON
          </div>
          <pre className="mono text-[12px] bg-slate-900 text-slate-300 rounded-lg p-3 overflow-auto max-h-[160px] whitespace-pre-wrap leading-relaxed">
            {JSON.stringify({
              "@context": "http://www.w3.org/ns/odrl.jsonld",
              "@type": "Set",
              "@id": selectedPolicy.id,
              "odrl:permission": [{
                "odrl:action": "use",
                "odrl:constraint": parseConstraint(selectedPolicy.constraint).map((c) => ({
                  "odrl:leftOperand": c.left,
                  "odrl:operator": { "@id": `odrl:${c.op}` },
                  "odrl:rightOperand": c.right,
                })),
              }],
            }, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
