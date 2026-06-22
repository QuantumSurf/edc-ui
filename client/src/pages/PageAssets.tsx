// Connector Hub — Asset Management (spec 4.2)
// Responsive table↔card, 3-step wizard with validation

import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { fetchAssets, fetchAssetById, deleteAsset, createAsset, updateAsset, fetchShellById } from "@/services";
import { type Asset } from "@/lib/data";
import { useConnectorStore } from "@/stores/connectorStore";
import {
  Card, CardTitle, Badge, SectionHdr, Stepper, FormField, JsonTreeView, PrimaryActionButton,
  inputBase, ListError, ListEmpty,
} from "@/components/ui-kmx";
import { DeleteConfirmDialog, ConfirmActionDialog, JsonViewerDialog, SlidePanel, InfoCard } from "@/components/DetailDeleteDialogs";
import { DataTablePagination, usePagination } from "@/components/DataTablePagination";
import { PlusCircle, Copy, Search, AlertCircle, CheckCircle2, Circle, Package, Filter, Globe, FileText, Server, Tags, Loader2, Files, X, Wand2, Pencil, Trash2, Code, ChevronsRight, List, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
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

  // Close the wizard slide panel and clear edit/duplicate context
  const closeWizard = () => {
    setWizardDirty(false);
    setEditTarget(null);
    setDuplicateSource(null);
    setTab("list");
  };
  // Close request from backdrop / Esc / cancel — guard unsaved changes
  const requestCloseWizard = () => {
    if (wizardDirty) { setPendingTabSwitch("list"); return; }
    closeWizard();
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

  const { paginatedData, totalItems, currentPage, pageSize, setCurrentPage, setPageSize } = usePagination(filtered, 10);

  return (
    <>
      <SectionHdr
        icon={<Package className="w-5 h-5 text-primary" />}        action={
          <RoleGate permission="resource:write">
            <PrimaryActionButton onClick={() => switchTab("wizard")} icon={<PlusCircle className="w-3 h-3" />}>
              {t.assets.createWizard}
            </PrimaryActionButton>
          </RoleGate>
        }
      >{t.assets.title}</SectionHdr>

      {/* Search & Filter — 검색+필터를 한 카드에 그룹화 (pcf 패턴) */}
          <div className="flex items-center gap-2 flex-wrap bg-card border border-border rounded-xl px-4 py-3 shadow-sm">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                placeholder={t.assets.searchPlaceholder}
                value={search}
                onChange={(e) => { setSearch(e.target.value); setCurrentPage(1); }}
                aria-label={t.assets.searchPlaceholder}
                className={`${inputBase} pl-8 pr-8 !bg-background`}
              />
              {search && (
                <button
                  onClick={() => { setSearch(""); setCurrentPage(1); }}
                  aria-label={t.common.clear ?? "Clear"}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            {/* Offering filter chips */}
            <div className="flex items-center gap-1">
              <Filter className="w-3 h-3 text-muted-foreground mr-0.5" />
              {(["all", "registered", "unregistered"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => { setOfferingFilter(f); setCurrentPage(1); }}
                  aria-pressed={offeringFilter === f}
                  className={`text-[11px] px-2 py-1 rounded-full border transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary ${
                    offeringFilter === f
                      ? "bg-primary text-primary-foreground border-primary font-medium"
                      : "border-border text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {f === "all" ? t.assets.filterAll : f === "registered" ? t.assets.filterRegistered : t.assets.filterUnregistered}
                </button>
              ))}
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
              <ListError onRetry={() => refetch()} fetching={isFetching} />
            </Card>
          )}

          {/* Desktop/Tablet: Table (creddef style) */}
          {!isLoading && !isError && (
          <div className="hidden md:block bg-card rounded-xl border border-border shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
              <span className="font-display text-[14px] font-bold text-foreground flex items-center gap-2 truncate">
                <List className="w-4 h-4 text-primary" />
                {t.assets.list}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px]">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="px-4 py-3 text-left text-[12px] font-bold text-foreground">{t.assets.col.name}</th>
                    <th className="px-4 py-3 text-left text-[12px] font-bold text-foreground">{t.assets.col.type}</th>
                    <th className="px-4 py-3 text-left text-[12px] font-bold text-foreground hidden xl:table-cell">{t.assets.col.semanticId}</th>
                    <th className="px-4 py-3 text-left text-[12px] font-bold text-foreground">{t.assets.col.offering}</th>
                    <th className="px-4 py-3 text-left text-[12px] font-bold text-foreground hidden lg:table-cell">{t.assets.col.dataSource}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {paginatedData.map((a) => (
                    <tr
                      key={a.id}
                      onClick={() => setDetailTarget(a)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDetailTarget(a); } }}
                      className={`table-row-hover cursor-pointer group focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary [&>td:first-child]:border-l-2 ${detailTarget?.id === a.id ? "bg-primary/5 [&>td:first-child]:border-l-primary" : "[&>td:first-child]:border-l-transparent"}`}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-primary truncate">{a.name || a.id}</div>
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="text-xs text-foreground truncate block">{a.id}</span>
                              <button
                                onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(a.id); toast.success(t.common.copied); }}
                                className="opacity-60 group-hover:opacity-100 transition-opacity flex-shrink-0 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded"
                                aria-label={t.common.copy ?? "Copy"}
                              >
                                <Copy className="w-2.5 h-2.5 text-muted-foreground hover:text-foreground" />
                              </button>
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3"><AssetTypeBadge type={a.type} /></td>
                      <td className="px-4 py-3 hidden xl:table-cell">
                        {a.sem ? (
                          <span className="text-xs text-foreground truncate block max-w-[250px]">{a.sem}</span>
                        ) : (
                          <span className="text-xs text-muted-foreground italic">{t.assets.notSet}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={a.offered ? "green" : "gray"}>
                          {a.offered ? <CheckCircle2 className="w-3 h-3" /> : <Circle className="w-3 h-3" />}
                          {a.offered ? t.assets.registered : t.assets.unregistered}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        {a.baseUrl ? (
                          <div className="flex items-center gap-1.5 min-w-0" title={a.baseUrl}>
                            <Globe size={11} className="text-muted-foreground shrink-0" />
                            <span className="text-xs text-foreground truncate max-w-[180px]">{extractDomain(a.baseUrl)}</span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtered.length === 0 && (
                assets.length === 0
                  ? <EmptyAssets onCreateClick={() => switchTab("wizard")} />
                  : <ListEmpty icon={<Search />} message={t.common.noResults} />
              )}
              {totalItems > 0 && (
                <DataTablePagination
                  totalItems={totalItems}
                  pageSize={pageSize}
                  currentPage={currentPage}
                  onPageChange={setCurrentPage}
                  onPageSizeChange={setPageSize}
                  rowsPerPageLabel={t.common.rowsPerPage}
                />
              )}
            </div>
          </div>
          )}

          {/* Mobile: Card Stack (spec 3.3.2) */}
          {!isLoading && !isError && (
          <div className="md:hidden flex flex-col gap-2.5">
            {paginatedData.map((a) => (
              <div key={a.id} onClick={() => setDetailTarget(a)} className="cursor-pointer"><AssetCard asset={a} /></div>
            ))}
            {filtered.length === 0 && (
              assets.length === 0
                ? <EmptyAssets onCreateClick={() => switchTab("wizard")} />
                : <ListEmpty icon={<Search />} message={t.common.noResults} />
            )}
          </div>
          )}
      <AssetWizard
        key={(editTarget?.id ?? "") + "|" + (duplicateSource?.id ?? "") + "|" + (editTarget ? "e" : duplicateSource ? "d" : "n")}
        open={tab === "wizard"}
        connectorId={connectorId}
        editTarget={editTarget}
        duplicateSource={duplicateSource}
        onDirtyChange={setWizardDirty}
        onDone={closeWizard}
        onCancel={requestCloseWizard}
      />

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
        onConfirm={() => { setPendingTabSwitch(null); closeWizard(); }}
      />

      {/* Detail Sheet */}
      {detailTarget && (
        <AssetDetailSheet
          target={detailTarget}
          shellLookup={shellLookup}
          isShellLooking={isShellLooking}
          onClose={() => setDetailTarget(null)}
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

/* ─── Asset Detail Sheet (IssuancePolicies-style) ────────────── */
type ShellLookup = { id: string; idShort?: string } | null | undefined;

function AssetDetailSheet({
  target, shellLookup, isShellLooking,
  onClose, onEdit, onDuplicate, onShowJson, onDelete, deleteDisabledReason,
}: {
  target: Asset;
  shellLookup: ShellLookup;
  isShellLooking: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onShowJson: () => void;
  onDelete?: () => void;
  deleteDisabledReason?: string;
}) {
  const { t } = useI18n();
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [onClose]);

  const dtrValue = !target.aasId
    ? t.twins.badge.noAasId
    : isShellLooking
      ? t.common.loading
      : shellLookup
        ? `${t.twins.badge.registered}: ${shellLookup.idShort || shellLookup.id}`
        : t.twins.badge.unregistered;

  return (
    <>
      <div
        className={cn("fixed inset-0 z-40 bg-black/20 transition-opacity duration-200", entered ? "opacity-100" : "opacity-0")}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className={cn(
          "fixed right-0 top-0 z-50 h-full w-full sm:max-w-2xl bg-card flex flex-col transition-transform duration-200 ease-out shadow-2xl",
          entered ? "translate-x-0" : "translate-x-full",
        )}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2 flex-wrap pr-8">
            <h2 className="text-[15px] font-semibold text-foreground truncate">{target.name || target.id}</h2>
            <AssetTypeBadge type={target.type} />
            <Badge variant={target.offered ? "green" : "gray"} pulse={target.offered}>
              {target.offered ? t.assets.registered : t.assets.unregistered}
            </Badge>
            <button
              onClick={onClose}
              className="ml-auto -mr-1 p-1 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              aria-label={t.common.close}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-6 space-y-5 text-xs">
          <div>
            <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1"><ChevronsRight className="w-3.5 h-3.5 text-primary" />{t.assets.sectionBasic}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <InfoCard label={t.assets.col.id} value={target.id} span mono copyable={target.id} />
              <InfoCard label={t.assets.col.name} value={target.name} />
              <InfoCard label={t.assets.col.type} value={target.type} />
              <InfoCard label={t.assets.description} value={target.description} span />
            </div>
          </div>

          <div>
            <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1"><ChevronsRight className="w-3.5 h-3.5 text-primary" />{t.assets.sectionDataSource}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <InfoCard label={t.assets.sourceType} value={target.dataAddressType} />
              <InfoCard label={t.assets.sourceUrl} value={target.baseUrl} span mono copyable={target.baseUrl || undefined} />
            </div>
          </div>

          <div>
            <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1"><ChevronsRight className="w-3.5 h-3.5 text-primary" />{t.assets.sectionMeta}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <InfoCard label={t.assets.col.semanticId} value={target.sem} span mono copyable={target.sem || undefined} />
              <InfoCard label="kmx:aasId" value={target.aasId} span mono copyable={target.aasId || undefined} />
              <InfoCard label={t.common.digitalTwinRegistry} value={dtrValue} span />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-muted/30 border-t border-border flex items-center gap-2 flex-shrink-0">
          {onDelete && (
            <button onClick={onDelete}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-md transition-colors">
              <Trash2 size={13} /> {t.common.delete}
            </button>
          )}
          {!onDelete && deleteDisabledReason && (
            <button disabled title={deleteDisabledReason}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted-foreground/40 cursor-not-allowed rounded-md">
              <Trash2 size={13} /> {t.common.delete}
            </button>
          )}
          <button onClick={onShowJson}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground rounded-md transition-colors">
            <Code size={13} /> JSON
          </button>
          <button onClick={onDuplicate}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground rounded-md transition-colors">
            <Files size={13} /> {t.common.duplicate}
          </button>
          <div className="flex-1" />
          <button onClick={onEdit}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors">
            <Pencil size={13} /> {t.common.edit}
          </button>
          <button onClick={onClose}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium border border-border text-foreground rounded-lg hover:bg-muted transition-colors">
            <X size={13} /> {t.common.close}
          </button>
        </div>
      </aside>
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
      <div className="w-14 h-14 rounded-2xl bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center mb-4">
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
        <div className="flex-1 min-w-0">
          <div className="text-xs font-bold text-primary truncate">{a.name || a.id}</div>
          <span className="text-xs text-foreground truncate block">{a.id}</span>
        </div>
        <button onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(a.id); toast.success(t.common.copied); }}>
          <Copy className="w-3 h-3 text-muted-foreground" />
        </button>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <AssetTypeBadge type={a.type} />
        <div className="flex items-center gap-1">
          <span className={`w-1.5 h-1.5 rounded-full ${a.offered ? "bg-emerald-500" : "bg-gray-300"}`} />
          <span className={`text-[11px] ${a.offered ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground"}`}>
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
      {a.sem && <span className="text-xs text-foreground mt-1.5 block truncate">{a.sem}</span>}
    </div>
  );
}

/* ─── Asset Type Badge ───────────────────────────────────────── */
function AssetTypeBadge({ type }: { type: string }) {
  const map: Record<string, "blue" | "sky" | "purple" | "amber" | "teal"> = {
    Bundle: "blue", PCF: "sky", DTR: "purple", BOM: "amber", QA: "teal",
  };
  return <Badge variant={map[type] ?? "gray"} className="!font-normal">{type}</Badge>;
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
function AssetWizard({ open, connectorId, editTarget, duplicateSource, onDone, onCancel, onDirtyChange }: { open: boolean; connectorId?: string; editTarget?: Asset | null; duplicateSource?: Asset | null; onDone: () => void; onCancel?: () => void; onDirtyChange?: (dirty: boolean) => void }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const isEdit = !!editTarget;
  const baseSrc: Asset | null = editTarget ?? duplicateSource ?? null;
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const steps = [t.assets.step1, t.assets.step2, t.assets.step3];

  // Step 1 state — duplicate appends "-copy" to ID, name keeps with " (Copy)"
  const initialId = editTarget ? editTarget.id : duplicateSource ? `${duplicateSource.id}-copy` : "kmx-new-asset-v1";
  const initialName = editTarget ? (editTarget.name ?? "") : duplicateSource ? `${duplicateSource.name ?? duplicateSource.id}${t.assets.copySuffix}` : "Serial Part Bundle v3";
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

  // Restart at the first step each time the panel opens
  useEffect(() => { if (open) setStep(0); }, [open]);

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

  const dataAddressObj = {
    "@type": addrType,
    baseUrl,
    proxyPath,
    proxyQueryParams: proxyQuery,
    authCode: `{{${authCode}}}`,
    contentType,
  };

  return (
    <SlidePanel open={open} onClose={onCancel ?? (() => {})} className="max-w-xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Wand2 className="w-4 h-4 text-primary flex-shrink-0" />
          <span className="text-[15px] font-semibold text-foreground truncate">
            {isEdit ? t.assets.editWizard : duplicateSource ? t.assets.duplicateWizard : t.assets.createWizard}
          </span>
        </div>
        <button
          onClick={onCancel}
          className="-mr-1 p-1 rounded hover:bg-muted text-muted-foreground flex-shrink-0"
          aria-label={t.common.close}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 min-w-0">
        {/* Stepper */}
        <Stepper steps={steps} current={step} icons={[<FileText />, <Server />, <Tags />]} />
        <div className="sm:hidden text-[12px] text-muted-foreground font-medium">
          {t.assets.stepMobile(step + 1, steps.length, steps[step])}
        </div>

      {/* Step 1: Basic Info */}
      {step === 0 && (
        <div className="space-y-4">
          <div className="mb-4">
            <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-1"><ChevronsRight className="w-3.5 h-3.5 text-primary" />{t.assets.step1}</div>
            <div className="h-px bg-border mt-1.5" />
          </div>
          <div className="grid grid-cols-1 gap-4">
            <FormField label={t.assets.assetId} required hint={isEdit ? t.assets.idImmutable : undefined}>
              <div className="relative">
                {isEdit && <Lock className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />}
                <input
                  value={assetId}
                  onChange={(e) => { setAssetId(e.target.value); setIdError(null); markDirty(); }}
                  disabled={isEdit}
                  title={isEdit ? t.assets.idImmutable : undefined}
                  className={cn(inputBase, "mono", isEdit && "pl-8")}
                />
              </div>
              {idError && (
                <div className="flex items-center gap-1 mt-1 text-[11px] text-rose-600 dark:text-rose-400">
                  <AlertCircle className="w-3 h-3" /> {idError}
                </div>
              )}
            </FormField>
            <FormField label={t.assets.dctType} required>
              <select
                value={dctType}
                onChange={(e) => { setDctType(e.target.value); markDirty(); }}
                className={inputBase}
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
                className={inputBase}
              />
            </FormField>
            <FormField label="cx-common:version">
              <input
                value={version}
                onChange={(e) => { setVersion(e.target.value); markDirty(); }}
                className={inputBase}
              />
            </FormField>
          </div>
          {/* Wizard nav: right-aligned on md+, sticky bottom on mobile (spec 3.3.3) */}
          <div className="flex items-center justify-end gap-2 pt-3 mt-2 border-t border-border">
            <button
              type="button"
              onClick={onCancel}
              className="text-[12px] px-3 py-1.5 rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors mr-auto"
            >
              {t.common.cancel}
            </button>
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
            <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-1"><ChevronsRight className="w-3.5 h-3.5 text-primary" />{t.assets.step2}</div>
            <div className="h-px bg-border mt-1.5" />
          </div>
          <div className="grid grid-cols-1 gap-4">
            <FormField label={t.assets.dataAddressType} required>
              <select value={addrType} onChange={(e) => { setAddrType(e.target.value); markDirty(); }}
                className={inputBase}>
                <option>HttpData</option>
                <option>AmazonS3</option>
                <option>AzureStorage</option>
              </select>
            </FormField>
            <FormField label={t.assets.baseUrlLabel} required>
              <input value={baseUrl} onChange={(e) => { setBaseUrl(e.target.value); markDirty(); }}
                className={`${inputBase} mono`} />
              {baseUrl && !baseUrl.startsWith("https://") && (
                <div className="flex items-center gap-1 mt-1 text-[11px] text-rose-600 dark:text-rose-400">
                  <AlertCircle className="w-3 h-3" /> {t.assets.httpsRequired}
                </div>
              )}
            </FormField>
            <FormField label={t.assets.proxyPath}>
              <select value={proxyPath} onChange={(e) => { setProxyPath(e.target.value); markDirty(); }}
                className={inputBase}>
                <option>true</option>
                <option>false</option>
              </select>
            </FormField>
            <FormField label={t.assets.authCodeLabel} required>
              <input value={authCode} onChange={(e) => { setAuthCode(e.target.value); markDirty(); }}
                className={`${inputBase} mono`} />
              {authCode && !authCode.startsWith("edc:key") && (
                <div className="flex items-center gap-1 mt-1 text-[11px] text-amber-600">
                  <AlertCircle className="w-3 h-3" /> {t.assets.authCodeHint}
                </div>
              )}
            </FormField>
            <FormField label={t.assets.proxyQueryParams}>
              <select value={proxyQuery} onChange={(e) => { setProxyQuery(e.target.value); markDirty(); }}
                className={inputBase}>
                <option>true</option>
                <option>false</option>
              </select>
            </FormField>
            <FormField label={t.assets.contentTypeLabel}>
              <input value={contentType} onChange={(e) => { setContentType(e.target.value); markDirty(); }}
                className={inputBase} />
            </FormField>
          </div>
          <div>
            <div className="text-[11px] font-medium text-muted-foreground mb-2 uppercase tracking-wide">{t.assets.dataAddressPreview}</div>
            <JsonTreeView data={dataAddressObj} />
          </div>
          <div className="flex items-center justify-end gap-2 pt-3 mt-2 border-t border-border">
            <button
              type="button"
              onClick={onCancel}
              className="text-[12px] px-3 py-1.5 rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors mr-auto"
            >
              {t.common.cancel}
            </button>
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
            <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-1"><ChevronsRight className="w-3.5 h-3.5 text-primary" />{t.assets.step3}</div>
            <div className="h-px bg-border mt-1.5" />
          </div>
          <div className="grid grid-cols-1 gap-4">
            <FormField label="aas-semantics:semanticId">
              <input value={semanticId} onChange={(e) => { setSemanticId(e.target.value); markDirty(); }}
                placeholder="urn:samm:io.catenax...."
                className={`${inputBase} mono`} />
              {semanticId && semanticId.startsWith("urn:samm:") && (
                <div className="flex items-center gap-1 mt-1 text-[11px] text-emerald-600">
                  <CheckCircle2 className="w-3 h-3" /> {t.assets.urnConfirmed}
                </div>
              )}
            </FormField>
            <FormField label="kmx:aasVersion">
              <input value={aasVersion} onChange={(e) => { setAasVersion(e.target.value); markDirty(); }}
                className={inputBase} />
            </FormField>
          </div>
          <div className="bg-muted rounded-md p-3">
            <div className="text-[11px] font-medium text-muted-foreground mb-2 uppercase tracking-wide">
              {t.assets.privateProps}
            </div>
            <div className="grid grid-cols-1 gap-4">
              <FormField label="kmx:aasId">
                <input value={aasId} onChange={(e) => { setAasId(e.target.value); markDirty(); }} placeholder="urn:uuid:..."
                  className={`${inputBase} mono`} />
              </FormField>
              <FormField label="kmx:submodelId">
                <input value={submodelId} onChange={(e) => { setSubmodelId(e.target.value); markDirty(); }} placeholder="urn:uuid:..."
                  className={`${inputBase} mono`} />
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
                      className="flex-1 text-[12px] px-2.5 py-1.5 border border-border rounded-md bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary mono"
                    />
                    <input
                      value={p.value}
                      onChange={(e) => updateCustomProp(idx, "value", e.target.value)}
                      placeholder={t.assets.propValue}
                      className="flex-1 text-[12px] px-2.5 py-1.5 border border-border rounded-md bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <button
                      onClick={() => removeCustomProp(idx)}
                      className="p-1.5 rounded hover:bg-rose-50 dark:hover:bg-rose-500/10 text-rose-500"
                      title={t.common.delete}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center justify-end gap-2 pt-3 mt-2 border-t border-border">
            <button
              type="button"
              onClick={onCancel}
              className="text-[12px] px-3 py-1.5 rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors mr-auto"
            >
              {t.common.cancel}
            </button>
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
      </div>
    </SlidePanel>
  );
}
