// Connector Hub — Data Offering Page (spec 4.4)
// 4-step wizard: Asset selection → Access policy → Contract policy → Publish
// Responsive table↔card, sticky wizard nav on mobile

import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import {
  fetchOfferings,
  fetchAssets,
  fetchPolicies,
  fetchNegotiations,
  createOffering,
  updateOffering,
  deleteOffering,
} from "@/services";
import { type Asset, type Policy, type Offering } from "@/lib/data";
import { useConnectorStore } from "@/stores/connectorStore";
import {
  DeleteConfirmDialog,
  ConfirmActionDialog,
  JsonViewerDialog,
  SlidePanel,
  InfoCard,
} from "@/components/DetailDeleteDialogs";
import {
  DataTablePagination,
  usePagination,
} from "@/components/DataTablePagination";
import {
  Card,
  CardTitle,
  Badge,
  MonoText,
  SectionHdr,
  Stepper,
  FormField,
  JsonTreeView,
  PrimaryActionButton,
  inputBase,
  ListError,
  ListEmpty,
} from "@/components/ui-kmx";
import {
  PlusCircle,
  Copy,
  Search,
  Loader2,
  AlertCircle,
  Database,
  Shield,
  X,
  Code,
  CheckCircle2,
  FileSignature,
  Pencil,
  Files,
  Trash2,
  ChevronsRight,
  List,
  Lock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { RoleGate } from "@/components/RoleGate";
import { toast } from "sonner";

const EDC_NS_ID = "https://w3id.org/edc/v0.0.1/ns/id";

interface PageOfferingProps {
  onNav: (path: string) => void;
}

export default function PageOffering({ onNav }: PageOfferingProps) {
  const { t } = useI18n();
  const connector = useConnectorStore(s => s.connector);
  const connectorId = connector?.id;
  const [tab, setTab] = useState<"list" | "wizard">("list");
  const [search, setSearch] = useState("");
  const [detailTarget, setDetailTarget] = useState<Offering | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Offering | null>(null);
  const [wizardDirty, setWizardDirty] = useState(false);
  const [pendingTabSwitch, setPendingTabSwitch] = useState<"list" | null>(null);
  const [editTarget, setEditTarget] = useState<Offering | null>(null);
  const [duplicateSource, setDuplicateSource] = useState<Offering | null>(null);
  const [jsonTarget, setJsonTarget] = useState<Offering | null>(null);

  const {
    data: offerings = [],
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery({
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

  // Close the wizard slide panel and clear edit/duplicate context
  const closeWizard = () => {
    setWizardDirty(false);
    setEditTarget(null);
    setDuplicateSource(null);
    setTab("list");
  };
  // Close request from backdrop / Esc / cancel — guard unsaved changes
  const requestCloseWizard = () => {
    if (wizardDirty) {
      setPendingTabSwitch("list");
      return;
    }
    closeWizard();
  };

  const filtered = offerings.filter(
    o =>
      (o.id ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (o.asset ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const {
    paginatedData,
    totalItems,
    currentPage,
    pageSize,
    setCurrentPage,
    setPageSize,
  } = usePagination(filtered, 10);

  const assetCount = (o: Offering) =>
    (o.asset ?? "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean).length;

  return (
    <>
      <SectionHdr
        icon={<FileSignature className="w-5 h-5 text-primary" />}
        subtitle={t.pageSubtitles.offerings}
        action={
          <RoleGate permission="resource:write">
            <PrimaryActionButton
              onClick={() => switchTab("wizard")}
              icon={<PlusCircle className="w-3 h-3" />}
            >
              {t.offerings.createWizard}
            </PrimaryActionButton>
          </RoleGate>
        }
      >
        {t.offerings.title}
      </SectionHdr>

      {/* Search — 검색을 카드에 그룹화 (목록 페이지와 통일) */}
      <div className="flex gap-2 flex-wrap bg-card border border-border rounded-xl px-4 py-3 shadow-sm">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder={t.offerings.searchPlaceholder}
            value={search}
            onChange={e => {
              setSearch(e.target.value);
              setCurrentPage(1);
            }}
            aria-label={t.offerings.searchPlaceholder}
            className={`${inputBase} pl-8 pr-8 !bg-background`}
          />
          {search && (
            <button
              onClick={() => {
                setSearch("");
                setCurrentPage(1);
              }}
              aria-label={t.common.clear ?? "Clear"}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
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

      {/* Desktop/Tablet: Table */}
      {!isLoading && !isError && (
        <div className="hidden md:block bg-card rounded-xl border border-border shadow-sm overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
            <span className="font-display text-[14px] font-bold text-foreground flex items-center gap-2 truncate">
              <List className="w-4 h-4 text-primary" />
              {t.offerings.list}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px]">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-4 py-3 text-left text-[12px] font-bold text-foreground">
                    {t.offerings.offeringId}
                  </th>
                  <th className="px-4 py-3 text-left text-[12px] font-bold text-foreground">
                    {t.offerings.step1}
                  </th>
                  <th className="px-4 py-3 text-left text-[12px] font-bold text-foreground">
                    {t.offerings.step2}
                  </th>
                  <th className="px-4 py-3 text-left text-[12px] font-bold text-foreground">
                    {t.offerings.step3}
                  </th>
                  <th className="px-4 py-3 text-left text-[12px] font-bold text-foreground">
                    {t.offerings.contractCount}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {paginatedData.map(o => {
                  const aCount = assetCount(o);
                  return (
                    <tr
                      key={o.id}
                      onClick={() => setDetailTarget(o)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={e => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setDetailTarget(o);
                        }
                      }}
                      className={cn(
                        "table-row-hover cursor-pointer group focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary [&>td:first-child]:border-l-2",
                        detailTarget?.id === o.id
                          ? "bg-primary/5 [&>td:first-child]:border-l-primary"
                          : "[&>td:first-child]:border-l-transparent"
                      )}
                    >
                      <td className="px-4 py-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-xs font-bold text-primary truncate block">
                              {o.id}
                            </span>
                            <button
                              onClick={e => {
                                e.stopPropagation();
                                navigator.clipboard.writeText(o.id);
                                toast.success(t.common.copied);
                              }}
                              className="opacity-60 group-hover:opacity-100 transition-opacity flex-shrink-0 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded"
                              aria-label={t.common.copy ?? "Copy"}
                            >
                              <Copy className="w-2.5 h-2.5 text-muted-foreground hover:text-foreground" />
                            </button>
                          </div>
                          <div className="text-xs text-foreground truncate">
                            {t.offerings.assetCount(aCount)}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span title={o.asset} className="block max-w-[220px]">
                          <span className="text-xs text-foreground truncate block">
                            {o.asset || "—"}
                          </span>
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant="purple"
                          className="!font-normal max-w-full"
                        >
                          <span className="truncate">{o.access || "—"}</span>
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant="purple"
                          className="!font-normal max-w-full"
                        >
                          <span className="truncate">{o.contract || "—"}</span>
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={cn(
                              "w-1.5 h-1.5 rounded-full flex-shrink-0",
                              o.cnt > 0
                                ? "bg-emerald-500"
                                : "bg-muted-foreground/40"
                            )}
                          />
                          <span
                            className={cn(
                              "text-xs",
                              o.cnt > 0
                                ? "text-emerald-700 dark:text-emerald-400"
                                : "text-foreground"
                            )}
                          >
                            {o.cnt}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filtered.length === 0 &&
              (offerings.length === 0 ? (
                <EmptyOfferings onCreateClick={() => switchTab("wizard")} />
              ) : (
                <ListEmpty icon={<Search />} message={t.common.noResults} />
              ))}
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

      {/* Mobile: Card Stack */}
      {!isLoading && !isError && (
        <div className="md:hidden flex flex-col gap-3">
          {paginatedData.map(o => (
            <div
              key={o.id}
              onClick={() => setDetailTarget(o)}
              className="cursor-pointer"
            >
              <OfferingCard offering={o} />
            </div>
          ))}
          {filtered.length === 0 &&
            (offerings.length === 0 ? (
              <EmptyOfferings onCreateClick={() => switchTab("wizard")} />
            ) : (
              <ListEmpty icon={<Search />} message={t.common.noResults} />
            ))}
        </div>
      )}
      {/* 위저드 탭일 때만 마운트 — 닫으면 unmount 되어 폼이 리셋된다(이전 입력 잔존 방지). */}
      {connectorId && tab === "wizard" && (
        <OfferingWizard
          key={
            (editTarget?.id ?? "") +
            "|" +
            (duplicateSource?.id ?? "") +
            "|" +
            (editTarget ? "e" : duplicateSource ? "d" : "n")
          }
          open={tab === "wizard"}
          assets={assets}
          policies={policies}
          connectorId={connectorId}
          existingOfferingIds={offerings.map(o => o.id)}
          editTarget={editTarget}
          duplicateSource={duplicateSource}
          onDirtyChange={setWizardDirty}
          onDone={closeWizard}
          onCancel={requestCloseWizard}
        />
      )}

      {/* JSON Viewer */}
      {jsonTarget && (
        <OfferingJsonDialog
          offering={jsonTarget}
          onClose={() => setJsonTarget(null)}
        />
      )}

      {/* Unsaved changes confirmation */}
      <ConfirmActionDialog
        open={!!pendingTabSwitch}
        onClose={() => setPendingTabSwitch(null)}
        title={t.common.unsavedChanges}
        description={t.common.unsavedChangesDesc}
        tone="warn"
        cancelLabel={t.common.stay}
        confirmLabel={t.common.leave}
        onConfirm={() => {
          setPendingTabSwitch(null);
          closeWizard();
        }}
      />

      {detailTarget && (
        <OfferingDetailSheet
          target={detailTarget}
          policies={policies}
          negotiations={negotiations}
          onClose={() => setDetailTarget(null)}
          onEdit={() => {
            setEditTarget(detailTarget);
            setDetailTarget(null);
            setTab("wizard");
          }}
          onDuplicate={() => {
            setDuplicateSource(detailTarget);
            setDetailTarget(null);
            setTab("wizard");
          }}
          onShowJson={() => {
            setJsonTarget(detailTarget);
            setDetailTarget(null);
          }}
          onDelete={
            detailTarget.cnt > 0
              ? undefined
              : () => {
                  setDeleteTarget(detailTarget);
                  setDetailTarget(null);
                }
          }
          deleteDisabledReason={
            detailTarget.cnt > 0
              ? t.offerings.deleteBlockedByContracts(detailTarget.cnt)
              : undefined
          }
        />
      )}

      {deleteTarget && connectorId && (
        <DeleteConfirmDialog
          open={!!deleteTarget}
          onClose={() => setDeleteTarget(null)}
          itemName={deleteTarget.id}
          onConfirm={() => deleteOffering(deleteTarget.id, connectorId)}
          queryKeys={[
            ["offerings", connectorId],
            ["policies", connectorId],
            ["assets", connectorId],
            ["sidebar-counts", connectorId],
          ]}
        />
      )}
    </>
  );
}

/* ─── Offering Detail Sheet (asset-style) ────────────────────── */
function OfferingDetailSheet({
  target,
  policies,
  negotiations,
  onClose,
  onEdit,
  onDuplicate,
  onShowJson,
  onDelete,
  deleteDisabledReason,
}: {
  target: Offering;
  policies: Policy[];
  negotiations: Array<{
    id: string;
    assetId?: string;
    name?: string;
    peer?: string;
    ts?: string;
  }>;
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
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [onClose]);

  const accessP = policies.find(p => p.id === target.access);
  const contractP = policies.find(p => p.id === target.contract);
  const assetIds = (target.asset ?? "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
  const relatedNegs = negotiations
    .filter(n => n.assetId && assetIds.includes(n.assetId))
    .slice(0, 5);
  const accessDeleted = !!target.access && !accessP;
  const contractDeleted = !!target.contract && !contractP;

  return (
    <>
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/20 transition-opacity duration-200",
          entered ? "opacity-100" : "opacity-0"
        )}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className={cn(
          "fixed right-0 top-0 z-50 h-full w-full sm:max-w-2xl bg-card flex flex-col transition-transform duration-200 ease-out shadow-2xl",
          entered ? "translate-x-0" : "translate-x-full"
        )}
      >
        <div className="px-6 py-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2 flex-wrap pr-8">
            <FileSignature className="w-4 h-4 text-primary flex-shrink-0" />
            <h2 className="text-[15px] font-semibold text-foreground truncate">
              {target.id}
            </h2>
            <Badge variant="purple" className="!font-normal">
              {t.offerings.assetCount(assetIds.length)}
            </Badge>
            <span
              className={cn(
                "inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border",
                target.cnt > 0
                  ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/30"
                  : "bg-muted text-muted-foreground border-border"
              )}
            >
              <span
                className={cn(
                  "w-1.5 h-1.5 rounded-full",
                  target.cnt > 0 ? "bg-emerald-500" : "bg-muted-foreground/40"
                )}
              />
              {t.offerings.contractCount}: {target.cnt}
            </span>
          </div>
        </div>
        {/* 닫기 — identityhub-ui Sheet 와 동일 우상단 절대 위치로 통일 */}
        <button
          onClick={onClose}
          aria-label={t.common.close}
          className="absolute top-4 right-4 z-10 rounded-xs opacity-70 transition-opacity hover:opacity-100 ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          <X className="size-4" />
        </button>

        <div className="flex-1 overflow-auto p-6 space-y-5 text-xs">
          <div>
            <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1">
              <ChevronsRight className="w-3.5 h-3.5 text-primary" />
              {t.offerings.col.asset}
            </p>
            <div className="grid grid-cols-1 gap-3">
              {assetIds.length === 0 ? (
                <p className="text-[11px] text-muted-foreground/60 italic">
                  {t.assets.notSet}
                </p>
              ) : (
                assetIds.map((id, i) => (
                  <InfoCard
                    key={id}
                    label={assetIds.length > 1 ? `#${i + 1}` : t.assets.col.id}
                    value={id}
                    mono
                    copyable={id}
                  />
                ))
              )}
            </div>
          </div>

          <div>
            <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1">
              <ChevronsRight className="w-3.5 h-3.5 text-primary" />
              {t.offerings.col.access}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <InfoCard
                label={t.policies.col.id}
                value={target.access}
                span
                mono
                copyable={target.access || undefined}
              />
              {accessDeleted ? (
                <InfoCard
                  label={t.offerings.policyStatus}
                  value={t.offerings.policyDeleted}
                  span
                />
              ) : (
                <InfoCard
                  label={t.policies.constraints}
                  value={accessP?.constraint || "—"}
                  span
                  mono
                />
              )}
            </div>
          </div>

          <div>
            <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1">
              <ChevronsRight className="w-3.5 h-3.5 text-primary" />
              {t.offerings.col.contract}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <InfoCard
                label={t.policies.col.id}
                value={target.contract}
                span
                mono
                copyable={target.contract || undefined}
              />
              {contractDeleted ? (
                <InfoCard
                  label={t.offerings.policyStatus}
                  value={t.offerings.policyDeleted}
                  span
                />
              ) : (
                <InfoCard
                  label={t.policies.constraints}
                  value={contractP?.constraint || "—"}
                  span
                  mono
                />
              )}
            </div>
          </div>

          {relatedNegs.length > 0 && (
            <div>
              <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1">
                <ChevronsRight className="w-3.5 h-3.5 text-primary" />
                {t.offerings.relatedNegotiations}
              </p>
              <div className="grid grid-cols-1 gap-3">
                {relatedNegs.map(n => (
                  <InfoCard
                    key={n.id}
                    label={n.name || "—"}
                    value={`${n.id.slice(0, 12)}…  ·  ${n.peer}  ·  ${n.ts}`}
                    mono
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 bg-muted/30 border-t border-border flex items-center gap-2 flex-shrink-0">
          {onDelete && (
            <button
              onClick={onDelete}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-md transition-colors"
            >
              <Trash2 size={13} /> {t.common.delete}
            </button>
          )}
          {!onDelete && deleteDisabledReason && (
            <button
              disabled
              title={deleteDisabledReason}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted-foreground/40 cursor-not-allowed rounded-md"
            >
              <Trash2 size={13} /> {t.common.delete}
            </button>
          )}
          <button
            onClick={onShowJson}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground rounded-md transition-colors"
          >
            <Code size={13} /> JSON
          </button>
          <button
            onClick={onDuplicate}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground rounded-md transition-colors"
          >
            <Files size={13} /> {t.common.duplicate}
          </button>
          <div className="flex-1" />
          <button
            onClick={onEdit}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
          >
            <Pencil size={13} /> {t.common.edit}
          </button>
          <button
            onClick={onClose}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium border border-border text-foreground rounded-lg hover:bg-muted transition-colors"
          >
            <X size={13} /> {t.common.close}
          </button>
        </div>
      </aside>
    </>
  );
}

/* ─── Offering Card (Mobile) ─────────────────────────────────── */
function EmptyOfferings({ onCreateClick }: { onCreateClick: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="w-14 h-14 rounded-2xl bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center mb-4">
        <FileSignature className="w-7 h-7 text-blue-400" />
      </div>
      <p className="text-[15px] font-semibold text-foreground/80 mb-1">
        {t.offerings.emptyTitle}
      </p>
      <p className="text-[12px] text-muted-foreground mb-4 max-w-[280px]">
        {t.offerings.emptyDesc}
      </p>
      <RoleGate permission="resource:write">
        <button
          onClick={onCreateClick}
          className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-md bg-primary hover:bg-primary/90 text-primary-foreground font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
        >
          <PlusCircle className="w-3.5 h-3.5" />
          {t.offerings.createWizard}
        </button>
      </RoleGate>
    </div>
  );
}

function OfferingCard({ offering: o }: { offering: Offering }) {
  const { t } = useI18n();
  return (
    <div className="bg-card rounded-xl p-3 shadow-sm border border-border">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold text-primary">{o.id}</span>
        <button
          onClick={e => {
            e.stopPropagation();
            navigator.clipboard.writeText(o.id);
            toast.success(t.common.copied);
          }}
        >
          <Copy className="w-3 h-3 text-muted-foreground" />
        </button>
      </div>
      <div className="text-xs text-foreground mb-1.5">{o.asset || "—"}</div>
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <Badge variant="purple" className="text-[11px]">
          {o.access || "—"}
        </Badge>
        <Badge variant="purple" className="text-[11px]">
          {o.contract || "—"}
        </Badge>
        <span className="ml-auto font-semibold text-foreground">{o.cnt}</span>
      </div>
    </div>
  );
}

/* ─── Offering Creation Wizard (spec 4.4 — 4 steps) ─────────── */
function OfferingWizard({
  open,
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
  open: boolean;
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
  // 동기 중복 제출 가드 — disabled={submitting}는 React state라 같은 틱 더블클릭을 못 막는다.
  const submittingRef = useRef(false);
  const steps = [
    t.offerings.step1,
    t.offerings.step2,
    t.offerings.step3,
    t.offerings.step4,
  ];

  // Wizard state — prefill from base source if editing/duplicating
  const initialAssets: string[] = baseSrc?.asset
    ? baseSrc.asset
        .split(",")
        .map(s => s.trim())
        .filter(Boolean)
    : [];
  const initialId = editTarget
    ? editTarget.id
    : duplicateSource
      ? `${duplicateSource.id}-copy`
      : "";
  const [selAssets, setSelAssets] = useState<string[]>(initialAssets);
  const [accessPolicy, setAccessPolicy] = useState(
    baseSrc?.access ?? policies[0]?.id ?? ""
  );
  const [contractPolicy, setContractPolicy] = useState(
    baseSrc?.contract ?? policies[0]?.id ?? ""
  );
  const [offeringId, setOfferingId] = useState(initialId);
  const [offeringIdError, setOfferingIdError] = useState<string | null>(null);
  const [assetSearch, setAssetSearch] = useState("");
  const [policySearch, setPolicySearch] = useState("");

  const filteredAssets = assets.filter(a => {
    const q = assetSearch.toLowerCase();
    return (
      !q ||
      (a.id ?? "").toLowerCase().includes(q) ||
      (a.name ?? "").toLowerCase().includes(q) ||
      (a.type ?? "").toLowerCase().includes(q)
    );
  });
  const filteredPolicies = policies.filter(p => {
    const q = policySearch.toLowerCase();
    return (
      !q ||
      (p.id ?? "").toLowerCase().includes(q) ||
      (p.constraint ?? "").toLowerCase().includes(q)
    );
  });

  // Reset dirty flag when target changes
  useEffect(() => {
    onDirtyChange?.(false);
  }, [editTarget?.id, duplicateSource?.id, onDirtyChange]);

  // Restart at the first step each time the panel opens
  useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  // policies 가 비동기로 늦게 도착하면 신규 생성 위저드의 기본 정책(첫 정책)을 채운다.
  // prev || first 가드로 이미 선택한 값/편집·복제 prefill 은 덮지 않는다.
  useEffect(() => {
    if (policies.length === 0) return;
    const first = policies[0].id;
    setAccessPolicy(prev => prev || first);
    setContractPolicy(prev => prev || first);
  }, [policies]);

  // assets 가 로드/갱신될 때 더 이상 존재하지 않는 선택 자산 ID 를 정리한다.
  // (자산 삭제 후 편집/복제 시 stale ID 가 재게시되어 잘못된 selector 가 박히는 것 방지.)
  useEffect(() => {
    const live = new Set(assets.map(a => a.id));
    setSelAssets(prev => {
      const pruned = prev.filter(id => live.has(id));
      return pruned.length === prev.length ? prev : pruned;
    });
  }, [assets]);

  const markDirty = () => {
    onDirtyChange?.(true);
  };

  const validateOfferingId = (id: string): string | null => {
    if (!id.trim()) return t.offerings.offeringIdRequired;
    if (id.length > 128) return t.offerings.idTooLong;
    if (/\s/.test(id)) return t.offerings.idNoSpaces;
    if (/[/?#%&]/.test(id)) return t.offerings.idInvalidChars;
    if (!isEdit && existingOfferingIds.includes(id))
      return t.offerings.idDuplicate;
    return null;
  };

  const toggleAsset = (id: string) => {
    setSelAssets(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
    markDirty();
  };

  const assetsSelectorObj =
    selAssets.length > 0
      ? {
          "@type": "CriterionDto",
          operandLeft: EDC_NS_ID,
          operator: "in",
          operandRight: selAssets,
        }
      : null;

  const handlePublish = async () => {
    // 발행 전 전체 재검증 — 단계 게이트를 통과한 뒤에도(예: Step 4에 머무는 동안
    // 선택 자산이 삭제되어 prune 효과로 비워지는 경우) 빈 자산/정책으로 발행되지 않도록
    // 최종 시점에 다시 확인하고, 문제 단계로 되돌린다.
    if (selAssets.length === 0) {
      toast.error(t.offerings.selectAssetRequired);
      setStep(0);
      return;
    }
    if (!accessPolicy) {
      toast.error(t.offerings.selectAccessRequired);
      setStep(1);
      return;
    }
    if (!contractPolicy) {
      toast.error(t.offerings.selectContractRequired);
      setStep(2);
      return;
    }
    const idErr = validateOfferingId(offeringId);
    if (idErr) {
      setOfferingIdError(idErr);
      toast.error(idErr);
      return;
    }
    // 더블클릭/중복 제출 방지 — 첫 호출 진행 중이면 이후 호출은 즉시 무시(계약 2개 생성 차단).
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const payload = {
        id: offeringId,
        asset: selAssets.join(","),
        access: accessPolicy,
        contract: contractPolicy,
      };
      if (isEdit) {
        await updateOffering(
          offeringId,
          payload as Record<string, unknown>,
          connectorId
        );
        toast.success(t.offerings.updated);
      } else {
        await createOffering(payload, connectorId);
        toast.success(t.offerings.published);
      }
    } catch {
      toast.error(
        isEdit ? t.offerings.updateFailed : t.offerings.publishFailed
      );
      submittingRef.current = false;
      setSubmitting(false);
      return;
    }
    try {
      await queryClient.refetchQueries({
        queryKey: ["offerings", connectorId],
      });
      queryClient.invalidateQueries({ queryKey: ["policies", connectorId] });
      queryClient.invalidateQueries({ queryKey: ["assets", connectorId] });
      queryClient.invalidateQueries({
        queryKey: ["sidebar-counts", connectorId],
      });
    } catch {}
    submittingRef.current = false;
    setSubmitting(false);
    onDone();
  };

  return (
    <SlidePanel
      open={open}
      onClose={onCancel ?? (() => {})}
      className="max-w-xl"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <FileSignature className="w-4 h-4 text-primary flex-shrink-0" />
          <span className="text-[15px] font-semibold text-foreground truncate">
            {isEdit
              ? t.offerings.editWizard
              : duplicateSource
                ? t.offerings.duplicateWizard
                : t.offerings.createWizard}
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
        <Stepper steps={steps} current={step} />
        <div className="sm:hidden text-[12px] text-muted-foreground font-medium">
          {t.offerings.stepMobile(step + 1, steps.length, steps[step])}
        </div>

        {/* Step 1: Asset Selection */}
        {step === 0 && (
          <div className="space-y-3">
            <div className="mb-1">
              <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                <ChevronsRight className="w-3.5 h-3.5 text-primary" />
                {t.offerings.step1}
              </div>
              <div className="h-px bg-border mt-1.5" />
            </div>

            {assets.length === 0 && (
              <div className="flex flex-col items-center justify-center py-8 gap-3 bg-muted/30 rounded-md border border-dashed border-border">
                <div className="w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center">
                  <Database className="w-5 h-5 text-blue-400" />
                </div>
                <div className="text-center">
                  <p className="text-[13px] font-semibold text-foreground/80">
                    {t.offerings.noAssetsTitle}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {t.offerings.noAssetsDesc}
                  </p>
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
                  onChange={e => setAssetSearch(e.target.value)}
                  className={`${inputBase} pl-8`}
                />
              </div>
            )}

            {filteredAssets.map(a => {
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
                      <span className="text-primary-foreground text-[11px]">
                        &#10003;
                      </span>
                    )}
                  </div>
                  <MonoText
                    className={`flex-1 text-[11px] ${isSelected ? "text-primary" : ""}`}
                  >
                    {a.id}
                  </MonoText>
                  <Badge variant="gray">{a.type}</Badge>
                </button>
              );
            })}

            {assetsSelectorObj && (
              <div className="mt-2">
                <div className="text-[11px] font-medium text-muted-foreground mb-2 uppercase tracking-wide">
                  {t.offerings.assetsSelector}
                </div>
                <JsonTreeView data={assetsSelectorObj} />
              </div>
            )}
          </div>
        )}

        {/* Step 2: Access Policy */}
        {step === 1 && (
          <div className="space-y-3">
            <div className="mb-1">
              <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                <ChevronsRight className="w-3.5 h-3.5 text-primary" />
                {t.offerings.step2}
              </div>
              <div className="h-px bg-border mt-1.5" />
            </div>
            <div className="bg-sky-50 dark:bg-sky-500/10 border border-sky-200 dark:border-sky-500/30 rounded-md px-3 py-2 text-[11px] text-sky-800 dark:text-sky-300">
              {t.offerings.whoCanSee}
            </div>
            {policies.length === 0 ? (
              <NoPoliciesHint
                connectorId={connectorId}
                navigate={navigate}
                t={t}
              />
            ) : (
              <>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder={t.offerings.searchPolicyPlaceholder}
                    value={policySearch}
                    onChange={e => setPolicySearch(e.target.value)}
                    className={`${inputBase} pl-8`}
                  />
                </div>
                <PolicySelector
                  policies={filteredPolicies}
                  selected={accessPolicy}
                  onSelect={id => {
                    setAccessPolicy(id);
                    markDirty();
                  }}
                />
              </>
            )}
          </div>
        )}

        {/* Step 3: Contract Policy */}
        {step === 2 && (
          <div className="space-y-3">
            <div className="mb-1">
              <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                <ChevronsRight className="w-3.5 h-3.5 text-primary" />
                {t.offerings.step3}
              </div>
              <div className="h-px bg-border mt-1.5" />
            </div>
            <div className="bg-violet-50 dark:bg-violet-500/10 border border-violet-200 dark:border-violet-500/30 rounded-md px-3 py-2 text-[11px] text-violet-800 dark:text-violet-300">
              {t.offerings.whoCanContract}
            </div>
            {policies.length === 0 ? (
              <NoPoliciesHint
                connectorId={connectorId}
                navigate={navigate}
                t={t}
              />
            ) : (
              <>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder={t.offerings.searchPolicyPlaceholder}
                    value={policySearch}
                    onChange={e => setPolicySearch(e.target.value)}
                    className={`${inputBase} pl-8`}
                  />
                </div>
                <PolicySelector
                  policies={filteredPolicies}
                  selected={contractPolicy}
                  onSelect={id => {
                    setContractPolicy(id);
                    markDirty();
                  }}
                />
              </>
            )}
          </div>
        )}

        {/* Step 4: Offering ID + Summary + Publish */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="mb-1">
              <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                <ChevronsRight className="w-3.5 h-3.5 text-primary" />
                {t.offerings.step4}
              </div>
              <div className="h-px bg-border mt-1.5" />
            </div>
            <FormField
              label={t.offerings.offeringId}
              required
              hint={isEdit ? t.offerings.idImmutable : undefined}
            >
              <div className="relative">
                {isEdit && (
                  <Lock className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                )}
                <input
                  value={offeringId}
                  onChange={e => {
                    setOfferingId(e.target.value);
                    setOfferingIdError(null);
                    markDirty();
                  }}
                  placeholder="cd-id"
                  disabled={isEdit}
                  title={isEdit ? t.offerings.idImmutable : undefined}
                  className={cn(inputBase, "mono", isEdit && "pl-8")}
                />
              </div>
              {offeringIdError && (
                <div className="flex items-center gap-1 mt-1 text-[11px] text-rose-600 dark:text-rose-400">
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
                <span className="text-muted-foreground">
                  {t.offerings.selectedAssets}
                </span>
                <span className="font-semibold">
                  {t.offerings.count(selAssets.length)}
                </span>
              </div>
              {selAssets.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {selAssets.map(id => (
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
                <span className="text-muted-foreground">
                  {t.offerings.step2}
                </span>
                <Badge variant="purple">{accessPolicy || "—"}</Badge>
              </div>
              <div className="flex justify-between items-center text-[12px]">
                <span className="text-muted-foreground">
                  {t.offerings.step3}
                </span>
                <Badge variant="purple">{contractPolicy || "—"}</Badge>
              </div>
            </div>

            {assetsSelectorObj && (
              <div>
                <div className="text-[11px] font-medium text-muted-foreground mb-2 uppercase tracking-wide">
                  {t.offerings.assetsSelector}
                </div>
                <JsonTreeView data={assetsSelectorObj} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* 통일 푸터 (PCF/ShellEditorDialog 패턴): 취소=좌측 버튼, 우측 단계 네비, 패널 하단 고정 */}
      <div className="flex items-center justify-end gap-2 px-3 py-2.5 border-t border-border bg-muted/20 flex-shrink-0">
        <button
          type="button"
          onClick={onCancel}
          className="text-[12px] px-3 py-1.5 rounded border border-border hover:bg-muted transition-colors mr-auto focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
        >
          {t.common.cancel}
        </button>
        {step > 0 && (
          <button
            type="button"
            onClick={() => setStep(step - 1)}
            className="text-[12px] px-3 py-1.5 rounded border border-border hover:bg-muted transition-colors text-muted-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
          >
            {t.common.prev}
          </button>
        )}
        {step === 0 && (
          <PrimaryActionButton
            disabled={selAssets.length === 0}
            onClick={() => setStep(1)}
          >
            {t.offerings.step2} &rarr;
          </PrimaryActionButton>
        )}
        {step === 1 && (
          <PrimaryActionButton
            disabled={!accessPolicy}
            onClick={() => setStep(2)}
          >
            {t.offerings.step3} &rarr;
          </PrimaryActionButton>
        )}
        {step === 2 && (
          <PrimaryActionButton
            disabled={!contractPolicy}
            onClick={() => setStep(3)}
          >
            {t.offerings.step4} &rarr;
          </PrimaryActionButton>
        )}
        {step === 3 && (
          <PrimaryActionButton disabled={submitting} onClick={handlePublish}>
            {submitting
              ? t.offerings.publishing
              : isEdit
                ? t.common.save
                : t.offerings.publish}
          </PrimaryActionButton>
        )}
      </div>
    </SlidePanel>
  );
}

/* ─── JSON Viewer (ContractDefinition) ───────────────────────── */
function OfferingJsonDialog({
  offering,
  onClose,
}: {
  offering: Offering;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const assetIds = (offering.asset ?? "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
  const envelope = {
    "@context": { "@vocab": "https://w3id.org/edc/v0.0.1/ns/" },
    "@id": offering.id,
    "@type": "ContractDefinition",
    accessPolicyId: offering.access,
    contractPolicyId: offering.contract,
    assetsSelector:
      assetIds.length > 0
        ? [
            {
              "@type": "CriterionDto",
              operandLeft: "https://w3id.org/edc/v0.0.1/ns/id",
              operator: "in",
              operandRight: assetIds,
            },
          ]
        : [],
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
function NoPoliciesHint({
  connectorId,
  navigate,
  t,
}: {
  connectorId: string;
  navigate: (path: string) => void;
  t: ReturnType<typeof useI18n>["t"];
}) {
  return (
    <div className="flex flex-col items-center justify-center py-8 gap-3 bg-muted/30 rounded-md border border-dashed border-border">
      <div className="w-10 h-10 rounded-lg bg-violet-50 dark:bg-violet-500/10 flex items-center justify-center">
        <Shield className="w-5 h-5 text-violet-400" />
      </div>
      <div className="text-center">
        <p className="text-[13px] font-semibold text-foreground/80">
          {t.offerings.noPoliciesTitle}
        </p>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          {t.offerings.noPoliciesDesc}
        </p>
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
  const selectedPolicy = policies.find(p => p.id === selected);

  const parseConstraint = (constraint: string) => {
    if (!constraint) return [];
    return constraint
      .split(/[;,]/)
      .map(s => s.trim())
      .filter(Boolean)
      .map(part => {
        const colonIdx = part.indexOf(":");
        if (colonIdx > -1) {
          return {
            left: part.substring(0, colonIdx).trim(),
            op: "eq",
            right: part.substring(colonIdx + 1).trim(),
          };
        }
        return { left: part, op: "eq", right: "" };
      });
  };

  return (
    <div className="space-y-2">
      {policies.map(p => {
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
            <div
              className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${
                isSelected ? "border-primary" : "border-border"
              }`}
            >
              {isSelected && (
                <div className="w-2 h-2 rounded-full bg-primary" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <MonoText
                  className={`text-[12px] font-medium ${isSelected ? "text-primary" : ""}`}
                >
                  {p.id}
                </MonoText>
                <Badge variant="gray" className="text-[11px] flex-shrink-0">
                  {t.policies.offeringRef(p.offers)}
                </Badge>
              </div>
              <div
                className={`text-[11px] mt-0.5 ${isSelected ? "text-primary/80" : "text-muted-foreground"}`}
              >
                {p.constraint}
              </div>
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
                <MonoText className="text-[11px] font-medium">
                  {c.left}
                </MonoText>
                <Badge variant="amber">{c.op}</Badge>
                <MonoText className="text-[11px] text-muted-foreground">
                  {c.right}
                </MonoText>
              </div>
            ))}
          </div>
          <div className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mt-2">
            ODRL JSON
          </div>
          <JsonTreeView
            className="max-h-[160px]"
            data={{
              "@context": "http://www.w3.org/ns/odrl.jsonld",
              "@type": "Set",
              "@id": selectedPolicy.id,
              "odrl:permission": [
                {
                  "odrl:action": "use",
                  "odrl:constraint": parseConstraint(
                    selectedPolicy.constraint
                  ).map(c => ({
                    "odrl:leftOperand": c.left,
                    "odrl:operator": { "@id": `odrl:${c.op}` },
                    "odrl:rightOperand": c.right,
                  })),
                },
              ],
            }}
          />
        </div>
      )}
    </div>
  );
}
