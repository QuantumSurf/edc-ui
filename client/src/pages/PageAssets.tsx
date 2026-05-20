// Connector Hub — Asset Management (spec 4.2)
// Responsive table↔card, 3-step wizard with validation

import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { fetchAssets, fetchAssetById, deleteAsset, createAsset, updateAsset, fetchShellById } from "@/services";
import { type Asset } from "@/lib/data";
import { useConnectorStore } from "@/stores/connectorStore";
import { Card, Badge, MonoText, SectionHdr, Stepper, FormField } from "@/components/ui-kmx";
import { DetailDialog, DeleteConfirmDialog, ConfirmActionDialog, JsonViewerDialog } from "@/components/DetailDeleteDialogs";
import { Pagination, paginate } from "@/components/Pagination";
import { PlusCircle, Copy, Search, AlertCircle, CheckCircle2, Package, Filter, Globe, FileText, Server, Tags, Loader2, RefreshCw, Files, X } from "lucide-react";
import { RoleGate } from "@/components/RoleGate";
import { toast } from "sonner";

interface PageAssetsProps {
  onNav: (path: string) => void;
}

type OfferingFilter = "all" | "registered" | "unregistered";

export default function PageAssets({ onNav }: PageAssetsProps) {
  const { t } = useI18n();
  const connector = useConnectorStore((s) => s.connector);
  const connectorId = connector?.id;
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"list" | "wizard">("list");
  const [page, setPage] = useState(1);
  const [detailTarget, setDetailTarget] = useState<Asset | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Asset | null>(null);
  const [offeringFilter, setOfferingFilter] = useState<OfferingFilter>("all");
  const [wizardDirty, setWizardDirty] = useState(false);
  const [pendingTabSwitch, setPendingTabSwitch] = useState<"list" | null>(null);
  const [editTarget, setEditTarget] = useState<Asset | null>(null);
  const [duplicateSource, setDuplicateSource] = useState<Asset | null>(null);
  const [jsonTarget, setJsonTarget] = useState<Asset | null>(null);

  const { data: assets = [], isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["assets", connectorId],
    queryFn: () => fetchAssets(connectorId!),
    enabled: !!connectorId,
  });

  // Check DTR Shell registration status when detail dialog has an aasId
  const detailAasId = detailTarget?.aasId;
  const { data: shellLookup, isFetching: isShellLooking } = useQuery({
    queryKey: ["shell-lookup", detailAasId],
    queryFn: () => fetchShellById(detailAasId!),
    enabled: !!detailAasId,
    staleTime: 30_000,
  });

  const switchTab = (next: "list" | "wizard") => {
    if (next === "list" && tab === "wizard" && wizardDirty) {
      setPendingTabSwitch("list");
      return;
    }
    setTab(next);
  };

  const filtered = assets.filter((a) => {
    const matchesSearch =
      (a.id ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (a.type ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (a.name ?? "").toLowerCase().includes(search.toLowerCase());
    const matchesFilter =
      offeringFilter === "all" ||
      (offeringFilter === "registered" && a.offered) ||
      (offeringFilter === "unregistered" && !a.offered);
    return matchesSearch && matchesFilter;
  });

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
              {t.assets.createWizard}
            </button>
          </RoleGate>
        }
      >{t.assets.title}</SectionHdr>

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
          {t.assets.list}
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
            {t.assets.wizard}
          </button>
        </RoleGate>
      </div>

      {tab === "list" && (
        <>
          {/* Search & Filter */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input
                type="text"
                placeholder={t.assets.searchPlaceholder}
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                className="w-full pl-8 pr-3 py-1.5 text-[12px] border border-border rounded-md bg-card focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            {/* Offering filter chips */}
            <div className="flex items-center gap-1">
              <Filter className="w-3 h-3 text-muted-foreground mr-0.5" />
              {(["all", "registered", "unregistered"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => { setOfferingFilter(f); setPage(1); }}
                  className={`text-[11px] px-2 py-1 rounded-full border transition-colors ${
                    offeringFilter === f
                      ? "bg-primary text-primary-foreground border-primary font-medium"
                      : "border-border text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {f === "all" ? t.assets.filterAll : f === "registered" ? t.assets.filterRegistered : t.assets.filterUnregistered}
                </button>
              ))}
            </div>
            {/* Result count */}
            <span className="text-[11px] text-muted-foreground ml-auto">
              {t.assets.resultCount(filtered.length, assets.length)}
            </span>
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

          {/* Desktop/Tablet: Table (spec 3.3.2) */}
          {!isLoading && !isError && (
          <Card noPad className="hidden md:block">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-muted/50 border-b border-border">
                  <tr>
                    {[t.assets.col.name, t.assets.col.type, t.assets.col.semanticId, t.assets.col.offering, t.assets.col.dataSource].map((h) => (
                      <th key={h} className="text-left !text-[12px] px-4 py-3 whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {paginate(filtered, page).map((a) => (
                    <tr key={a.id} onClick={() => setDetailTarget(a)} className="hover:bg-muted/30 transition-colors group cursor-pointer">
                      {/* Name + ID (primary column) */}
                      <td className="px-4 py-3">
                        <div className="flex items-start gap-2.5">
                          <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                            <Package className="w-4 h-4 text-blue-500" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="!text-[12px] font-normal text-foreground truncate">
                              {a.name || a.id}
                            </div>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <MonoText className="!text-[12px] !font-normal text-muted-foreground truncate">{a.id}</MonoText>
                              <button
                                onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(a.id); toast.success(t.common.copied); }}
                                className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                              >
                                <Copy className="w-2.5 h-2.5 text-muted-foreground hover:text-foreground" />
                              </button>
                            </div>
                          </div>
                        </div>
                      </td>
                      {/* Type */}
                      <td className="px-4 py-3">
                        <AssetTypeBadge type={a.type} />
                      </td>
                      {/* Semantic ID */}
                      <td className="px-4 py-3 max-w-[200px] hidden xl:table-cell">
                        {a.sem ? (
                          <MonoText className="truncate block !text-[12px] !font-normal">{a.sem}</MonoText>
                        ) : (
                          <span className="!text-[12px] text-muted-foreground/40 italic">{t.assets.notSet}</span>
                        )}
                      </td>
                      {/* Offering status */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${a.offered ? "bg-emerald-500" : "bg-gray-300"}`} />
                          <span className={`!text-[12px] font-normal ${a.offered ? "text-emerald-700" : "text-muted-foreground"}`}>
                            {a.offered ? t.assets.registered : t.assets.unregistered}
                          </span>
                        </div>
                      </td>
                      {/* Data Source */}
                      <td className="px-4 py-3 hidden lg:table-cell">
                        {a.baseUrl ? (
                          <div className="flex items-center gap-1.5" title={a.baseUrl}>
                            <Globe className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                            <MonoText className="!text-[12px] !font-normal truncate max-w-[180px]">
                              {extractDomain(a.baseUrl)}
                            </MonoText>
                          </div>
                        ) : (
                          <span className="!text-[12px] text-muted-foreground/40">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filtered.length === 0 && (
              <EmptyAssets onCreateClick={() => switchTab("wizard")} />
            )}
            <div className="px-4 pb-3">
              <Pagination total={filtered.length} page={page} onPageChange={setPage} />
            </div>
          </Card>
          )}

          {/* Mobile: Card Stack (spec 3.3.2) */}
          {!isLoading && !isError && (
          <div className="md:hidden flex flex-col gap-2.5">
            {paginate(filtered, page).map((a) => (
              <div key={a.id} onClick={() => setDetailTarget(a)} className="cursor-pointer"><AssetCard asset={a} /></div>
            ))}
            {filtered.length === 0 && (
              <EmptyAssets onCreateClick={() => switchTab("wizard")} />
            )}
          </div>
          )}
        </>
      )}

      {tab === "wizard" && (
        <AssetWizard
          key={(editTarget?.id ?? "") + "|" + (duplicateSource?.id ?? "") + "|" + (editTarget ? "e" : duplicateSource ? "d" : "n")}
          connectorId={connectorId}
          editTarget={editTarget}
          duplicateSource={duplicateSource}
          onDirtyChange={setWizardDirty}
          onDone={() => { setWizardDirty(false); setEditTarget(null); setDuplicateSource(null); setTab("list"); }}
          onCancel={() => { setWizardDirty(false); setEditTarget(null); setDuplicateSource(null); setTab("list"); }}
        />
      )}

      {/* JSON Viewer */}
      {jsonTarget && <AssetJsonDialog asset={jsonTarget} onClose={() => setJsonTarget(null)} />}

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

      {/* Detail Dialog */}
      {detailTarget && (
        <DetailDialog
          open={!!detailTarget}
          onClose={() => setDetailTarget(null)}
          title={detailTarget.name || detailTarget.id}
          subtitle={detailTarget.id}
          sections={[
            {
              title: t.assets.sectionBasic,
              fields: [
                { label: t.assets.col.id, value: detailTarget.id, mono: true, copyable: true },
                { label: t.assets.col.name, value: detailTarget.name || "—" },
                { label: t.assets.col.type, value: detailTarget.type, badge: { text: detailTarget.type || "N/A", variant: "blue" } },
                { label: t.assets.description, value: detailTarget.description || "—" },
              ],
            },
            {
              title: t.assets.sectionDataSource,
              fields: [
                { label: t.assets.sourceType, value: detailTarget.dataAddressType, badge: { text: detailTarget.dataAddressType || "N/A", variant: "purple" } },
                { label: t.assets.sourceUrl, value: detailTarget.baseUrl, mono: true, copyable: !!detailTarget.baseUrl },
              ],
            },
            {
              title: t.assets.sectionMeta,
              fields: [
                { label: t.assets.col.semanticId, value: detailTarget.sem, mono: true, copyable: !!detailTarget.sem },
                ...(detailTarget.aasId
                  ? [
                      { label: "kmx:aasId", value: detailTarget.aasId, mono: true, copyable: true },
                      {
                        label: "Digital Twin Registry",
                        value: isShellLooking
                          ? t.common.loading
                          : shellLookup
                            ? `${t.twins.badge.registered}: ${shellLookup.idShort || shellLookup.id}`
                            : t.twins.badge.unregistered,
                        badge: isShellLooking
                          ? { text: "…", variant: "gray" as const }
                          : shellLookup
                            ? { text: t.twins.badge.registered, variant: "green" as const }
                            : { text: t.twins.badge.unregistered, variant: "amber" as const },
                      },
                    ]
                  : [{ label: "kmx:aasId", value: t.twins.badge.noAasId, badge: { text: t.twins.badge.noAasId, variant: "gray" as const } }]),
              ],
            },
            {
              title: t.assets.sectionOffering,
              fields: [
                { label: t.assets.col.offering, value: detailTarget.offered ? t.assets.registered : t.assets.unregistered, badge: { text: detailTarget.offered ? t.assets.registered : t.assets.unregistered, variant: detailTarget.offered ? "green" : "gray" } },
              ],
            },
          ]}
          onEdit={() => { setEditTarget(detailTarget); setDetailTarget(null); setTab("wizard"); }}
          onDuplicate={() => { setDuplicateSource(detailTarget); setDetailTarget(null); setTab("wizard"); }}
          onShowJson={() => { setJsonTarget(detailTarget); setDetailTarget(null); }}
          onDelete={detailTarget.offered ? undefined : () => { setDeleteTarget(detailTarget); setDetailTarget(null); }}
          deleteDisabledReason={detailTarget.offered ? t.assets.deleteBlockedByOffering : undefined}
        />
      )}

      {/* Delete Confirmation */}
      {deleteTarget && connectorId && (
        <DeleteConfirmDialog
          open={!!deleteTarget}
          onClose={() => setDeleteTarget(null)}
          itemName={deleteTarget.id}
          onConfirm={() => deleteAsset(deleteTarget.id, connectorId)}
          queryKeys={[["assets", connectorId]]}
        />
      )}
    </>
  );
}

/* ─── JSON Viewer Dialog ─────────────────────────────────────── */
function AssetJsonDialog({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const { t } = useI18n();
  const envelope = {
    "@context": {
      "@vocab": "https://w3id.org/edc/v0.0.1/ns/",
      cx: "https://w3id.org/catenax/ontology/common#",
      "cx-taxo": "https://w3id.org/catenax/taxonomy#",
      "cx-common": "https://w3id.org/catenax/ontology/common#",
      "aas-semantics": "https://admin-shell.io/aas/3/0/HasSemantics/",
    },
    "@id": asset.id,
    "@type": "Asset",
    properties: {
      name: asset.name,
      "dct:type": { "@id": asset.type },
      "cx-common:version": asset.ver,
      "aas-semantics:semanticId": asset.sem ?? null,
      ...(asset.customProperties ?? {}),
    },
    privateProperties: {
      "kmx:aasVersion": asset.aasVersion,
      "kmx:aasId": asset.aasId,
      "kmx:submodelId": asset.submodelId,
    },
    dataAddress: {
      "@type": asset.dataAddressType ?? "HttpData",
      baseUrl: asset.baseUrl,
      proxyPath: asset.proxyPath,
      proxyQueryParams: asset.proxyQueryParams,
      contentType: asset.contentType,
    },
  };
  return (
    <JsonViewerDialog
      open={true}
      onClose={onClose}
      title={t.assets.jsonTitle}
      subtitle={asset.id}
      json={JSON.stringify(envelope, null, 2)}
      downloadName={asset.id}
    />
  );
}

/* ─── Empty State ────────────────────────────────────────────── */
function EmptyAssets({ onCreateClick }: { onCreateClick: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="w-14 h-14 rounded-2xl bg-blue-50 flex items-center justify-center mb-4">
        <Package className="w-7 h-7 text-blue-400" />
      </div>
      <p className="text-[15px] font-semibold text-foreground/80 mb-1">{t.assets.emptyTitle}</p>
      <p className="text-[12px] text-muted-foreground mb-4 max-w-[260px]">{t.assets.emptyDesc}</p>
      <RoleGate permission="resource:write">
        <button
          onClick={onCreateClick}
          className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-md bg-primary hover:bg-primary/90 text-primary-foreground font-medium transition-colors"
        >
          <PlusCircle className="w-3.5 h-3.5" />
          {t.assets.createWizard}
        </button>
      </RoleGate>
    </div>
  );
}

/* ─── Asset Card (Mobile) ────────────────────────────────────── */
function AssetCard({ asset: a }: { asset: Asset }) {
  const { t } = useI18n();
  return (
    <div className="bg-card rounded-xl p-3.5 shadow-sm border border-border hover:shadow-md transition-shadow">
      <div className="flex items-start gap-2.5 mb-2">
        <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
          <Package className="w-4 h-4 text-blue-500" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-foreground truncate">{a.name || a.id}</div>
          <MonoText className="text-[11px] text-muted-foreground truncate block">{a.id}</MonoText>
        </div>
        <button onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(a.id); toast.success(t.common.copied); }}>
          <Copy className="w-3 h-3 text-muted-foreground" />
        </button>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <AssetTypeBadge type={a.type} />
        <div className="flex items-center gap-1">
          <span className={`w-1.5 h-1.5 rounded-full ${a.offered ? "bg-emerald-500" : "bg-gray-300"}`} />
          <span className={`text-[11px] ${a.offered ? "text-emerald-700" : "text-muted-foreground"}`}>
            {a.offered ? t.assets.registered : t.assets.unregistered}
          </span>
        </div>
        {a.baseUrl && (
          <div className="flex items-center gap-1 ml-auto">
            <Globe className="w-2.5 h-2.5 text-muted-foreground" />
            <span className="text-[11px] text-muted-foreground truncate max-w-[120px]">{extractDomain(a.baseUrl)}</span>
          </div>
        )}
      </div>
      {a.sem && <MonoText className="text-[11px] text-muted-foreground mt-1.5 block truncate">{a.sem}</MonoText>}
    </div>
  );
}

/* ─── Asset Type Badge ───────────────────────────────────────── */
function AssetTypeBadge({ type }: { type: string }) {
  const map: Record<string, "blue" | "sky" | "purple" | "amber" | "teal"> = {
    Bundle: "blue", PCF: "sky", DTR: "purple", BOM: "amber", QA: "teal",
  };
  return <Badge variant={map[type] ?? "gray"}>{type}</Badge>;
}

/* ─── URL Domain Extractor ───────────────────────────────────── */
function extractDomain(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname + u.pathname;
  } catch {
    return url;
  }
}

/* ─── Asset Creation Wizard (spec 4.2.2 — 3 steps) ──────────── */
function AssetWizard({ connectorId, editTarget, duplicateSource, onDone, onCancel, onDirtyChange }: { connectorId?: string; editTarget?: Asset | null; duplicateSource?: Asset | null; onDone: () => void; onCancel?: () => void; onDirtyChange?: (dirty: boolean) => void }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const isEdit = !!editTarget;
  const baseSrc: Asset | null = editTarget ?? duplicateSource ?? null;
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const steps = [t.assets.step1, t.assets.step2, t.assets.step3];

  // Step 1 state — duplicate appends "-copy" to ID, name keeps with " (Copy)"
  const initialId = editTarget ? editTarget.id : duplicateSource ? `${duplicateSource.id}-copy` : "kmx-new-asset-v1";
  const initialName = editTarget ? (editTarget.name ?? "") : duplicateSource ? `${duplicateSource.name ?? duplicateSource.id} (Copy)` : "Serial Part Bundle v3";
  const [assetId, setAssetId] = useState(initialId);
  const [dctType, setDctType] = useState(baseSrc?.type ?? "cx-taxo:SubmodelBundle");
  const [label, setLabel] = useState(initialName);
  const [version, setVersion] = useState(baseSrc?.ver ?? "v3.0");
  const [idError, setIdError] = useState<string | null>(null);

  // Step 2 state
  const [addrType, setAddrType] = useState(baseSrc?.dataAddressType ?? "HttpData");
  const [baseUrl, setBaseUrl] = useState(baseSrc?.baseUrl ?? "https://submodel-server.kmx.io/api/v3/submodel");
  const [proxyPath, setProxyPath] = useState(baseSrc?.proxyPath ?? "true");
  const [authCode, setAuthCode] = useState("edc:key=kmx-submodel-key");
  const [proxyQuery, setProxyQuery] = useState(baseSrc?.proxyQueryParams ?? "true");
  const [contentType, setContentType] = useState(baseSrc?.contentType ?? "application/json");

  // Step 3 state
  const [semanticId, setSemanticId] = useState(baseSrc?.sem ?? "urn:samm:io.catenax.pcf:8.0.0");
  const [aasVersion, setAasVersion] = useState(baseSrc?.aasVersion ?? "8.0.0");
  const [aasId, setAasId] = useState(baseSrc?.aasId ?? "");
  const [submodelId, setSubmodelId] = useState(baseSrc?.submodelId ?? "");

  // Custom properties (arbitrary key-value pairs)
  const [customProps, setCustomProps] = useState<{ key: string; value: string }[]>(
    baseSrc?.customProperties ? Object.entries(baseSrc.customProperties).map(([key, value]) => ({ key, value })) : []
  );
  const updateCustomProp = (idx: number, field: "key" | "value", val: string) => {
    setCustomProps((arr) => arr.map((p, i) => (i === idx ? { ...p, [field]: val } : p)));
    markDirty();
  };
  const addCustomProp = () => { setCustomProps((arr) => [...arr, { key: "", value: "" }]); markDirty(); };
  const removeCustomProp = (idx: number) => { setCustomProps((arr) => arr.filter((_, i) => i !== idx)); markDirty(); };

  // Reset dirty flag whenever target changes
  useEffect(() => { onDirtyChange?.(false); }, [editTarget?.id, duplicateSource?.id, onDirtyChange]);

  const markDirty = () => { onDirtyChange?.(true); };

  // Stricter ID validation (URL-unsafe chars + length)
  const validateAssetId = (id: string): string | null => {
    if (!id.trim()) return t.assets.idRequired;
    if (id.length > 128) return t.assets.idTooLong;
    if (/\s/.test(id)) return t.assets.idNoSpaces;
    if (/[/?#%&]/.test(id)) return t.assets.idInvalidChars;
    return null;
  };

  const [checkingId, setCheckingId] = useState(false);
  // Validation
  const validateStep1 = async () => {
    const formatErr = validateAssetId(assetId);
    if (formatErr) { setIdError(formatErr); return false; }
    if (!connectorId || isEdit) { setIdError(null); return true; }
    setCheckingId(true);
    try {
      const existing = await fetchAssetById(assetId, connectorId);
      if (existing) { setIdError(t.assets.idDuplicate); return false; }
    } finally {
      setCheckingId(false);
    }
    setIdError(null);
    return true;
  };

  const validateStep2 = () => {
    if (!baseUrl.trim()) { toast.error(t.assets.baseUrlRequired); return false; }
    if (!baseUrl.startsWith("https://")) { toast.error(t.assets.httpsRequired); return false; }
    if (authCode && !authCode.startsWith("edc:key")) { toast.error(t.assets.authCodeFormat); return false; }
    return true;
  };

  const validateStep3 = () => {
    if (semanticId && !semanticId.startsWith("urn:samm:")) {
      toast.error(t.assets.semanticIdFormat);
      return false;
    }
    return true;
  };

  const dataAddressJson = JSON.stringify({
    "@type": addrType,
    baseUrl,
    proxyPath,
    proxyQueryParams: proxyQuery,
    authCode: `{{${authCode}}}`,
    contentType,
  }, null, 2);

  return (
    <Card
      title={isEdit ? t.assets.editWizard : duplicateSource ? t.assets.duplicateWizard : t.assets.createWizard}
      actions={onCancel ? (
        <button
          onClick={onCancel}
          className="text-[11px] px-2 py-1 rounded border border-border hover:bg-muted text-muted-foreground"
        >
          {t.common.cancel}
        </button>
      ) : undefined}
    >
      {/* Stepper: horizontal on md+, vertical text on mobile (spec 3.3.3) */}
      <div className="hidden sm:block">
        <Stepper steps={steps} current={step} icons={[<FileText />, <Server />, <Tags />]} />
      </div>
      <div className="sm:hidden text-[12px] text-muted-foreground mb-3 font-medium">
        {t.assets.stepMobile(step + 1, steps.length, steps[step])}
      </div>

      {/* Step 1: Basic Info */}
      {step === 0 && (
        <div className="space-y-4">
          <div className="mb-4">
            <div className="text-[12px] font-semibold text-muted-foreground">{t.assets.step1}</div>
            <div className="h-px bg-border mt-1.5" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label={t.assets.assetId} required>
              <input
                value={assetId}
                onChange={(e) => { setAssetId(e.target.value); setIdError(null); markDirty(); }}
                disabled={isEdit}
                title={isEdit ? t.assets.idImmutable : undefined}
                className="w-full text-[12px] px-2.5 py-1.5 border border-border rounded-md bg-muted focus:outline-none focus:ring-1 focus:ring-primary mono disabled:opacity-60 disabled:cursor-not-allowed"
              />
              {idError && (
                <div className="flex items-center gap-1 mt-1 text-[11px] text-rose-600">
                  <AlertCircle className="w-3 h-3" /> {idError}
                </div>
              )}
            </FormField>
            <FormField label={t.assets.dctType} required>
              <select
                value={dctType}
                onChange={(e) => { setDctType(e.target.value); markDirty(); }}
                className="w-full text-[12px] px-2.5 py-1.5 border border-border rounded-md bg-muted focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="cx-taxo:SubmodelBundle">cx-taxo:SubmodelBundle</option>
                <option value="cx-taxo:DigitalTwinRegistry">cx-taxo:DigitalTwinRegistry</option>
                <option value="cx-taxo:PCF">cx-taxo:PCF</option>
                <option value="cx-taxo:BOM">cx-taxo:BOM</option>
              </select>
            </FormField>
            <FormField label={t.assets.assetName}>
              <input
                value={label}
                onChange={(e) => { setLabel(e.target.value); markDirty(); }}
                className="w-full text-[12px] px-2.5 py-1.5 border border-border rounded-md bg-muted focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </FormField>
            <FormField label="cx-common:version">
              <input
                value={version}
                onChange={(e) => { setVersion(e.target.value); markDirty(); }}
                className="w-full text-[12px] px-2.5 py-1.5 border border-border rounded-md bg-muted focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </FormField>
          </div>
          {/* Wizard nav: right-aligned on md+, sticky bottom on mobile (spec 3.3.3) */}
          <div className="flex justify-end gap-2 pt-2 sm:static fixed bottom-14 left-0 right-0 sm:bg-transparent bg-card sm:p-0 p-3 sm:border-0 border-t border-border z-30">
            <button
              disabled={checkingId}
              onClick={async () => { if (await validateStep1()) setStep(1); }}
              className="text-[12px] px-3 py-1.5 rounded bg-primary hover:bg-primary/90 text-primary-foreground font-medium transition-colors w-full sm:w-auto disabled:opacity-50"
            >
              {checkingId ? t.common.loading : t.assets.nextDataAddress}
            </button>
          </div>
        </div>
      )}

      {/* Step 2: DataAddress */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="mb-4">
            <div className="text-[12px] font-semibold text-muted-foreground">{t.assets.step2}</div>
            <div className="h-px bg-border mt-1.5" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label={t.assets.dataAddressType} required>
              <select value={addrType} onChange={(e) => { setAddrType(e.target.value); markDirty(); }}
                className="w-full text-[12px] px-2.5 py-1.5 border border-border rounded-md bg-muted focus:outline-none focus:ring-1 focus:ring-primary">
                <option>HttpData</option>
                <option>AmazonS3</option>
                <option>AzureStorage</option>
              </select>
            </FormField>
            <FormField label={t.assets.baseUrlLabel} required>
              <input value={baseUrl} onChange={(e) => { setBaseUrl(e.target.value); markDirty(); }}
                className="w-full text-[12px] px-2.5 py-1.5 border border-border rounded-md bg-muted focus:outline-none focus:ring-1 focus:ring-primary mono" />
              {baseUrl && !baseUrl.startsWith("https://") && (
                <div className="flex items-center gap-1 mt-1 text-[11px] text-rose-600">
                  <AlertCircle className="w-3 h-3" /> {t.assets.httpsRequired}
                </div>
              )}
            </FormField>
            <FormField label={t.assets.proxyPath}>
              <select value={proxyPath} onChange={(e) => { setProxyPath(e.target.value); markDirty(); }}
                className="w-full text-[12px] px-2.5 py-1.5 border border-border rounded-md bg-muted focus:outline-none focus:ring-1 focus:ring-primary">
                <option>true</option>
                <option>false</option>
              </select>
            </FormField>
            <FormField label={t.assets.authCodeLabel} required>
              <input value={authCode} onChange={(e) => { setAuthCode(e.target.value); markDirty(); }}
                className="w-full text-[12px] px-2.5 py-1.5 border border-border rounded-md bg-muted focus:outline-none focus:ring-1 focus:ring-primary mono" />
              {authCode && !authCode.startsWith("edc:key") && (
                <div className="flex items-center gap-1 mt-1 text-[11px] text-amber-600">
                  <AlertCircle className="w-3 h-3" /> {t.assets.authCodeHint}
                </div>
              )}
            </FormField>
            <FormField label={t.assets.proxyQueryParams}>
              <select value={proxyQuery} onChange={(e) => { setProxyQuery(e.target.value); markDirty(); }}
                className="w-full text-[12px] px-2.5 py-1.5 border border-border rounded-md bg-muted focus:outline-none focus:ring-1 focus:ring-primary">
                <option>true</option>
                <option>false</option>
              </select>
            </FormField>
            <FormField label={t.assets.contentTypeLabel}>
              <input value={contentType} onChange={(e) => { setContentType(e.target.value); markDirty(); }}
                className="w-full text-[12px] px-2.5 py-1.5 border border-border rounded-md bg-muted focus:outline-none focus:ring-1 focus:ring-primary" />
            </FormField>
          </div>
          <div>
            <div className="text-[11px] font-medium text-muted-foreground mb-2 uppercase tracking-wide">{t.assets.dataAddressPreview}</div>
            <pre className="mono text-[12px] bg-slate-900 text-slate-300 rounded-lg p-3 overflow-auto whitespace-pre-wrap leading-relaxed">{dataAddressJson}</pre>
          </div>
          <div className="flex justify-end gap-2 pt-2 sm:static fixed bottom-14 left-0 right-0 sm:bg-transparent bg-card sm:p-0 p-3 sm:border-0 border-t border-border z-30">
            <button onClick={() => setStep(0)} className="text-[12px] px-3 py-1.5 rounded border border-border hover:bg-muted transition-colors text-muted-foreground">
              {t.common.prev}
            </button>
            <button
              onClick={() => { if (validateStep2()) setStep(2); }}
              className="text-[12px] px-3 py-1.5 rounded bg-primary hover:bg-primary/90 text-primary-foreground font-medium transition-colors flex-1 sm:flex-initial"
            >
              {t.assets.nextAasMeta}
            </button>
          </div>
        </div>
      )}

      {/* Step 3: AAS Metadata */}
      {step === 2 && (
        <div className="space-y-4">
          <div className="mb-4">
            <div className="text-[12px] font-semibold text-muted-foreground">{t.assets.step3}</div>
            <div className="h-px bg-border mt-1.5" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="aas-semantics:semanticId">
              <input value={semanticId} onChange={(e) => { setSemanticId(e.target.value); markDirty(); }}
                placeholder="urn:samm:io.catenax...."
                className="w-full text-[12px] px-2.5 py-1.5 border border-border rounded-md bg-muted focus:outline-none focus:ring-1 focus:ring-primary mono" />
              {semanticId && semanticId.startsWith("urn:samm:") && (
                <div className="flex items-center gap-1 mt-1 text-[11px] text-emerald-600">
                  <CheckCircle2 className="w-3 h-3" /> {t.assets.urnConfirmed}
                </div>
              )}
            </FormField>
            <FormField label="kmx:aasVersion">
              <input value={aasVersion} onChange={(e) => { setAasVersion(e.target.value); markDirty(); }}
                className="w-full text-[12px] px-2.5 py-1.5 border border-border rounded-md bg-muted focus:outline-none focus:ring-1 focus:ring-primary" />
            </FormField>
          </div>
          <div className="bg-muted rounded-md p-3">
            <div className="text-[11px] font-medium text-muted-foreground mb-2 uppercase tracking-wide">
              {t.assets.privateProps}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField label="kmx:aasId">
                <input value={aasId} onChange={(e) => { setAasId(e.target.value); markDirty(); }} placeholder="urn:uuid:..."
                  className="w-full text-[12px] px-2.5 py-1.5 border border-border rounded-md bg-card focus:outline-none focus:ring-1 focus:ring-primary mono" />
              </FormField>
              <FormField label="kmx:submodelId">
                <input value={submodelId} onChange={(e) => { setSubmodelId(e.target.value); markDirty(); }} placeholder="urn:uuid:..."
                  className="w-full text-[12px] px-2.5 py-1.5 border border-border rounded-md bg-card focus:outline-none focus:ring-1 focus:ring-primary mono" />
              </FormField>
            </div>
          </div>

          {/* Custom Properties */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                {t.assets.customProps}
              </div>
              <button
                onClick={addCustomProp}
                className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-border hover:bg-muted text-muted-foreground"
              >
                <PlusCircle className="w-3 h-3" /> {t.assets.addProp}
              </button>
            </div>
            {customProps.length === 0 ? (
              <p className="text-[11px] text-muted-foreground/60 italic">{t.assets.noCustomProps}</p>
            ) : (
              <div className="space-y-2">
                {customProps.map((p, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <input
                      value={p.key}
                      onChange={(e) => updateCustomProp(idx, "key", e.target.value)}
                      placeholder={t.assets.propKey}
                      className="flex-1 text-[12px] px-2.5 py-1.5 border border-border rounded-md bg-card focus:outline-none focus:ring-1 focus:ring-primary mono"
                    />
                    <input
                      value={p.value}
                      onChange={(e) => updateCustomProp(idx, "value", e.target.value)}
                      placeholder={t.assets.propValue}
                      className="flex-1 text-[12px] px-2.5 py-1.5 border border-border rounded-md bg-card focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <button
                      onClick={() => removeCustomProp(idx)}
                      className="p-1.5 rounded hover:bg-rose-50 text-rose-500"
                      title={t.common.delete}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2 sm:static fixed bottom-14 left-0 right-0 sm:bg-transparent bg-card sm:p-0 p-3 sm:border-0 border-t border-border z-30">
            <button onClick={() => setStep(1)} className="text-[12px] px-3 py-1.5 rounded border border-border hover:bg-muted transition-colors text-muted-foreground">
              {t.common.prev}
            </button>
            <button
              disabled={saving}
              onClick={async () => {
                if (!validateStep3()) return;
                if (!connectorId) { toast.error(t.assets.noConnector); return; }
                setSaving(true);
                try {
                  const customPropsObj = customProps.reduce<Record<string, string>>((acc, p) => {
                    const k = p.key.trim();
                    if (k) acc[k] = p.value;
                    return acc;
                  }, {});
                  const payload = {
                    id: assetId,
                    type: dctType,
                    name: label,
                    ver: version,
                    sem: semanticId || null,
                    dataAddressType: addrType,
                    baseUrl,
                    proxyPath,
                    proxyQueryParams: proxyQuery,
                    authCode,
                    contentType,
                    aasVersion: aasVersion || undefined,
                    aasId: aasId || undefined,
                    submodelId: submodelId || undefined,
                    customProperties: Object.keys(customPropsObj).length > 0 ? customPropsObj : undefined,
                  };
                  if (isEdit) {
                    await updateAsset(assetId, payload as Record<string, unknown>, connectorId);
                  } else {
                    await createAsset(payload, connectorId);
                  }
                  await queryClient.invalidateQueries({ queryKey: ["assets", connectorId] });
                  toast.success(isEdit ? t.assets.updateComplete : t.assets.createComplete);
                  onDone();
                } catch (err) {
                  const cause =
                    (err as { response?: { data?: { error?: string } } })?.response?.data?.error
                    ?? (err instanceof Error ? err.message : String(err));
                  toast.error(`${isEdit ? t.assets.updateFailed : t.assets.createFailed}: ${cause}`);
                } finally {
                  setSaving(false);
                }
              }}
              className="text-[12px] px-3 py-1.5 rounded bg-primary hover:bg-primary/90 text-primary-foreground font-medium transition-colors flex-1 sm:flex-initial disabled:opacity-50"
            >
              {saving ? t.common.saving : isEdit ? t.common.save : t.assets.finish}
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}
