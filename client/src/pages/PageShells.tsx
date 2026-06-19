// Connector Hub — Digital Twin Registry (Tractus-X DTR)
// Lists Shell Descriptors and supports create/delete; submodels shown inline in detail dialog.

import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { fetchShells, createShell, updateShell, deleteShell, fetchShellRaw } from "@/services";
import type { ShellDescriptor, SpecificAssetId } from "@/lib/data";
import {
  Card, Badge, SectionHdr, FormField, PrimaryActionButton, inputBase,
  ListCard, ListHeaderRow, ListRow, ListColLabel, ListEmpty, ListError,
} from "@/components/ui-kmx";

const SHELL_COLS = "grid-cols-[1.2fr_1.6fr_1.6fr_1.4fr_0.7fr_90px]";
import { DataTablePagination, usePagination } from "@/components/DataTablePagination";
import { SlidePanel, InfoCard, DetailSection, JsonViewerDialog, DeleteConfirmDialog } from "@/components/DetailDeleteDialogs";
import { ExposeSubmodelDialog, type ExposeTarget } from "@/components/ExposeSubmodelDialog";
import { ExposeDtrDialog } from "@/components/ExposeDtrDialog";
import { Boxes, PlusCircle, Plus, Trash2, Search, RefreshCw, Loader2, X, Pencil, FileJson, BookMarked, Share2, Lock, MoreVertical } from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { RoleGate } from "@/components/RoleGate";
import { cn } from "@/lib/utils";
import {
  type SubmodelInput,
  newSubmodel,
  submodelInputToBody,
  rawSubmodelToInput,
  SubmodelFormFields,
  EndpointDetail,
} from "@/components/SubmodelForm";
import { toast } from "sonner";

export default function PageShells() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<ShellDescriptor | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ShellDescriptor | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<"create" | "edit">("create");
  const [editorAasId, setEditorAasId] = useState<string | undefined>(undefined);
  const [jsonView, setJsonView] = useState<ShellDescriptor | null>(null);
  const [exposeTarget, setExposeTarget] = useState<ExposeTarget | null>(null);
  const [exposeDtrOpen, setExposeDtrOpen] = useState(false);

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["shells"],
    queryFn: () => fetchShells({ limit: 200 }),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchInterval: false,
  });
  const shells = data?.items ?? [];

  const filtered = shells.filter((s) => {
    const q = search.toLowerCase();
    if (!q) return true;
    return (
      s.id.toLowerCase().includes(q) ||
      s.idShort.toLowerCase().includes(q) ||
      s.globalAssetId.toLowerCase().includes(q)
    );
  });

  const { paginatedData, totalItems, currentPage, pageSize, setCurrentPage, setPageSize } = usePagination(filtered, 10);

  return (
    <>
      <SectionHdr
        icon={<BookMarked className="w-5 h-5 text-primary" />}
        breadcrumb={t.twins.subtitle}
        action={
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded border border-border hover:bg-muted disabled:opacity-50 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
            >
              <RefreshCw className={`w-3 h-3 ${isFetching ? "animate-spin" : ""}`} />
              {t.twins.refresh}
            </button>
            <RoleGate permission="resource:write">
              <button
                onClick={() => setExposeDtrOpen(true)}
                className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded border border-border hover:bg-muted text-foreground font-medium focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
              >
                <Share2 className="w-3 h-3" />
                {t.twins.exposeDtr.action}
              </button>
              <PrimaryActionButton
                onClick={() => { setEditorMode("create"); setEditorAasId(undefined); setEditorOpen(true); }}
                icon={<PlusCircle className="w-3 h-3" />}
              >
                {t.twins.create}
              </PrimaryActionButton>
            </RoleGate>
          </div>
        }
      >
        {t.twins.title}
      </SectionHdr>

      {/* Search & Filter — fl-aggregator TasksPage style */}
      <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder={t.twins.searchPlaceholder}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setCurrentPage(1); }}
            aria-label={t.twins.searchPlaceholder}
            className={`${inputBase} pl-8`}
          />
        </div>
      </div>

      {/* Loading */}
      {isLoading && (
        <Card>
          <div className="flex items-center justify-center py-10 gap-2 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-[13px]">{t.common.loading}</span>
          </div>
        </Card>
      )}

      {/* Error */}
      {!isLoading && isError && (
        <Card>
          <ListError onRetry={() => refetch()} fetching={isFetching} />
        </Card>
      )}

      {/* Empty */}
      {!isLoading && !isError && shells.length === 0 && (
        <Card>
          <ListEmpty icon={<Boxes />} message={t.twins.empty} />
        </Card>
      )}

      {/* List — fl-aggregator ListCard */}
      {!isLoading && !isError && shells.length > 0 && (
        <ListCard
          title={t.twins.listTitle}
        >
          <ListHeaderRow cols={SHELL_COLS}>
            <ListColLabel>{t.twins.col.idShort}</ListColLabel>
            <ListColLabel>{t.twins.col.aasId}</ListColLabel>
            <ListColLabel className="hidden lg:block">{t.twins.col.globalAssetId}</ListColLabel>
            <ListColLabel className="hidden md:block">{t.twins.col.specificAssetIds}</ListColLabel>
            <ListColLabel>{t.twins.col.submodels}</ListColLabel>
            <ListColLabel className="text-right">{t.twins.col.action}</ListColLabel>
          </ListHeaderRow>
          {filtered.length === 0 ? (
            <ListEmpty icon={<Boxes />} message={t.twins.noSearchResults} />
          ) : (
            paginatedData.map((s) => (
              <ListRow key={s.id} cols={SHELL_COLS} onClick={() => setDetail(s)}>
                <div className="min-w-0">
                  <span className="text-xs font-bold text-primary truncate block">{s.idShort || "—"}</span>
                </div>
                <div className="min-w-0">
                  <span className="text-xs text-foreground truncate block">{s.id}</span>
                </div>
                <div className="hidden lg:block min-w-0">
                  <span className="text-xs text-foreground truncate block">{s.globalAssetId || "—"}</span>
                </div>
                <div className="hidden md:block min-w-0">
                  <div className="flex flex-wrap gap-1">
                    {s.specificAssetIds.slice(0, 2).map((sa, i) => (
                      <Badge key={i} variant="gray">{sa.name}={sa.value}</Badge>
                    ))}
                    {s.specificAssetIds.length > 2 && (
                      <span className="text-[10px] text-muted-foreground">+{s.specificAssetIds.length - 2}</span>
                    )}
                  </div>
                </div>
                <div>
                  <Badge variant={s.submodelCount > 0 ? "blue" : "gray"}>{s.submodelCount}</Badge>
                </div>
                <div className="flex items-center justify-end" onClick={(e) => e.stopPropagation()}>
                  <RoleGate permission="resource:write">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          aria-label={t.twins.col.action}
                          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                        >
                          <MoreVertical className="w-4 h-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => { setEditorMode("edit"); setEditorAasId(s.id); setEditorOpen(true); }}>
                          <Pencil className="w-3.5 h-3.5" /> {t.common.edit}
                        </DropdownMenuItem>
                        <DropdownMenuItem variant="destructive" onClick={() => setDeleteTarget(s)}>
                          <Trash2 className="w-3.5 h-3.5" /> {t.common.delete}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </RoleGate>
                </div>
              </ListRow>
            ))
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
        </ListCard>
      )}

      {/* Detail dialog */}
      <ShellDetailDialog
        shell={detail}
        onClose={() => setDetail(null)}
        onEdit={() => { if (detail) { setEditorMode("edit"); setEditorAasId(detail.id); setEditorOpen(true); setDetail(null); } }}
        onDelete={() => { setDeleteTarget(detail); setDetail(null); }}
        onViewJson={() => { if (detail) { setJsonView(detail); setDetail(null); } }}
        onExpose={(tgt) => setExposeTarget(tgt)}
      />

      {/* Expose submodel to catalog */}
      <ExposeSubmodelDialog
        target={exposeTarget}
        onClose={() => setExposeTarget(null)}
        onDone={() => { qc.invalidateQueries({ queryKey: ["shells"] }); }}
      />

      {/* Expose the DTR itself to catalog */}
      <ExposeDtrDialog
        open={exposeDtrOpen}
        onClose={() => setExposeDtrOpen(false)}
        onDone={() => { /* registry list unchanged; asset/offering created on connector */ }}
      />

      {/* JSON view dialog */}
      <ShellJsonDialog
        shell={jsonView}
        onClose={() => setJsonView(null)}
      />

      {/* Create dialog */}
      <ShellEditorDialog
        open={editorOpen}
        mode={editorMode}
        initialAasId={editorAasId}
        onClose={() => setEditorOpen(false)}
        onSaved={() => { setEditorOpen(false); qc.invalidateQueries({ queryKey: ["shells"] }); }}
      />

      {/* Delete confirm */}
      <DeleteConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        itemName={deleteTarget?.idShort ?? deleteTarget?.id ?? ""}
        subtitle={deleteTarget?.id}
        onConfirm={async () => { if (deleteTarget) await deleteShell(deleteTarget.id); }}
        queryKeys={[["shells"]]}
        successMessage={deleteTarget ? t.twins.msg.deleted(deleteTarget.idShort) : undefined}
      />
    </>
  );
}

/* ─── Detail dialog ──────────────────────────────────────────── */
function ShellDetailDialog({
  shell, onClose, onEdit, onDelete, onViewJson, onExpose,
}: { shell: ShellDescriptor | null; onClose: () => void; onEdit: () => void; onDelete: () => void; onViewJson: () => void; onExpose: (target: ExposeTarget) => void }) {
  const { t } = useI18n();
  if (!shell) return null;
  const copy = (s: string) => { navigator.clipboard.writeText(s); toast.success(t.common.copied); };
  return (
    <SlidePanel open={!!shell} onClose={onClose} className="sm:max-w-2xl">
      {/* Header */}
      <div className="px-6 pt-5 pb-4 pr-10 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          <BookMarked className="w-5 h-5 text-primary flex-shrink-0" />
          <h2 className="text-[15px] font-semibold text-foreground truncate">{shell.idShort || t.twins.detail.title}</h2>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto p-5 space-y-5 text-xs">
        {/* 기본 정보 */}
        <DetailSection title={t.twins.detail.title}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <InfoCard label={t.twins.col.aasId} value={shell.id} span mono copyable={shell.id} />
            <InfoCard label={t.twins.col.globalAssetId} value={shell.globalAssetId} span mono copyable={shell.globalAssetId || undefined} />
          </div>
        </DetailSection>

        {/* 설명 */}
        {(shell.descriptions ?? []).length > 0 && (
          <DetailSection title={t.twins.form.description}>
            <div className="space-y-1.5">
              {(shell.descriptions ?? []).map((d, i) => (
                <div key={i} className="flex items-start gap-2">
                  <Badge variant="gray">{d.language || "—"}</Badge>
                  <span className="flex-1 break-words text-foreground">{d.text}</span>
                </div>
              ))}
            </div>
          </DetailSection>
        )}

        {/* specificAssetIds */}
        <DetailSection title={t.twins.col.specificAssetIds}>
          {shell.specificAssetIds.length === 0
            ? <span className="text-muted-foreground">—</span>
            : <div className="flex flex-wrap gap-1">
                {shell.specificAssetIds.map((sa, i) => (
                  <Badge key={i} variant="gray">{sa.name}={sa.value}</Badge>
                ))}
              </div>}
        </DetailSection>

        {/* Submodels */}
        <DetailSection title={t.twins.detail.submodels}>
          {shell.submodelDescriptors.length === 0
            ? <span className="text-muted-foreground">{t.twins.detail.noSubmodels}</span>
            : <ul className="space-y-2 min-w-0">
                {shell.submodelDescriptors.map((sub) => (
                  <li key={sub.id} className="bg-muted/30 rounded-lg border border-border p-3 space-y-2 min-w-0 overflow-hidden">
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-foreground">{sub.idShort}</div>
                        <span className="text-[11px] font-normal text-muted-foreground truncate block">{sub.id}</span>
                        {sub.semanticId && (
                          <span className="text-[11px] font-normal text-muted-foreground truncate block">semanticId: {sub.semanticId}</span>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1 flex-shrink-0">
                        <RoleGate permission="resource:write">
                          <button
                            onClick={() => onExpose({ aasId: shell.id, submodelId: sub.id, idShort: sub.idShort, semanticId: sub.semanticId })}
                            className="inline-flex items-center gap-1 h-7 text-[11px] px-2.5 rounded-md border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                          >
                            <Share2 className="w-3 h-3" />
                            {t.twins.expose.action}
                          </button>
                        </RoleGate>
                      </div>
                    </div>
                    {(sub.endpoints ?? []).length > 0 && (
                      <div className="space-y-1.5 pl-2 border-l-2 border-violet-300">
                        {(sub.endpoints ?? []).map((ep, ei) => (
                          <EndpointDetail key={ei} ep={ep} index={ei} onCopy={copy} />
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>}
        </DetailSection>
      </div>

      {/* Footer */}
      <div className="px-5 py-4 bg-muted/30 border-t border-border flex items-center gap-2 flex-shrink-0">
        <RoleGate permission="resource:write">
          <button
            onClick={onDelete}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 rounded-md transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-rose-400"
          >
            <Trash2 size={13} /> {t.common.delete}
          </button>
        </RoleGate>
        <button
          onClick={onViewJson}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground rounded-md transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
        >
          <FileJson size={13} /> {t.twins.detail.viewJson}
        </button>
        <div className="flex-1" />
        <RoleGate permission="resource:write">
          <button
            onClick={onEdit}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
          >
            <Pencil size={13} /> {t.common.edit}
          </button>
        </RoleGate>
        <button
          onClick={onClose}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium border border-border text-foreground rounded-md hover:bg-muted transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
        >
          <X size={13} /> {t.common.close}
        </button>
      </div>
    </SlidePanel>
  );
}

/* ─── JSON view dialog ───────────────────────────────────────── */
function ShellJsonDialog({ shell, onClose }: { shell: ShellDescriptor | null; onClose: () => void }) {
  const { t } = useI18n();
  const [raw, setRaw] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!shell) { setRaw(null); return; }
    setLoading(true);
    fetchShellRaw(shell.id)
      .then((data) => setRaw(data))
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setLoading(false));
  }, [shell]);

  if (!shell) return null;
  // 공용 JsonViewerDialog로 위임(트리/원문 토글·모두 펼치기/접기·검색·복사 피드백 공통 제공)
  return (
    <JsonViewerDialog
      open={!!shell}
      onClose={onClose}
      loading={loading}
      title={t.twins.detail.jsonTitle}
      subtitle={shell.id}
      json={raw ? JSON.stringify(raw, null, 2) : ""}
      downloadName={shell.idShort || "shell"}
    />
  );
}

/** Convert a raw DTR shell payload back into editor state. */
function rawToEditorState(raw: Record<string, unknown>) {
  const desc = (raw.description as Array<{ language?: string; text?: string }>) ?? [];
  const findByLang = (langs: string[]): string => {
    for (const l of langs) {
      const m = desc.find((d) => (d.language ?? "").toLowerCase().startsWith(l));
      if (m?.text) return m.text;
    }
    return "";
  };
  const specsRaw = (raw.specificAssetIds as Array<Record<string, unknown>>) ?? [];
  const subsRaw = (raw.submodelDescriptors as Array<Record<string, unknown>>) ?? [];
  return {
    aasId: (raw.id as string) ?? "",
    idShort: (raw.idShort as string) ?? "",
    globalAssetId: (raw.globalAssetId as string) ?? "",
    descriptionKo: findByLang(["ko"]),
    descriptionEn: findByLang(["en"]),
    specs: specsRaw.map((s) => ({ name: (s.name as string) ?? "", value: (s.value as string) ?? "" })),
    subs: subsRaw.map((s) => rawSubmodelToInput(s)),
  };
}

/* ─── Editor dialog (create + edit) ─────────────────────── */
function ShellEditorDialog({
  open, mode, initialAasId, onClose, onSaved,
}: {
  open: boolean;
  mode: "create" | "edit";
  initialAasId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [idShort, setIdShort] = useState("");
  const [aasId, setAasId] = useState("");
  const [globalAssetId, setGlobalAssetId] = useState("");
  const [descriptionKo, setDescriptionKo] = useState("");
  const [descriptionEn, setDescriptionEn] = useState("");
  const [specs, setSpecs] = useState<SpecificAssetId[]>([]);
  const [subs, setSubs] = useState<SubmodelInput[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(false);

  const reset = () => {
    setIdShort(""); setAasId(""); setGlobalAssetId(""); setDescriptionKo(""); setDescriptionEn(""); setSpecs([]); setSubs([]);
  };

  // Pre-fill on edit-mode open
  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && initialAasId) {
      setLoading(true);
      fetchShellRaw(initialAasId)
        .then((raw) => {
          if (!raw) { toast.error(t.twins.msg.loadFailed); return; }
          const s = rawToEditorState(raw);
          setIdShort(s.idShort);
          setAasId(s.aasId);
          setGlobalAssetId(s.globalAssetId);
          setDescriptionKo(s.descriptionKo);
          setDescriptionEn(s.descriptionEn);
          setSpecs(s.specs);
          setSubs(s.subs.length > 0 ? s.subs : []);
        })
        .finally(() => setLoading(false));
    } else {
      reset();
    }
  }, [open, mode, initialAasId]);

  const submit = async () => {
    if (!aasId || !idShort) {
      toast.error(t.twins.msg.requiredAasId);
      return;
    }
    for (const s of subs) {
      if (!s.id || !s.idShort) {
        toast.error(t.twins.msg.requiredSubmodel);
        return;
      }
      for (const ep of s.endpoints) {
        if (!ep.protocolInformation.href) {
          toast.error(t.twins.msg.requiredEndpointHref);
          return;
        }
      }
    }
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        id: aasId,
        idShort,
        globalAssetId,
        specificAssetIds: specs.filter((s) => s.name && s.value),
        submodelDescriptors: subs.map(submodelInputToBody),
      };
      const descriptions: Array<{ language: string; text: string }> = [];
      if (descriptionKo) descriptions.push({ language: "ko", text: descriptionKo });
      if (descriptionEn) descriptions.push({ language: "en", text: descriptionEn });
      if (descriptions.length > 0) {
        body.description = descriptions;
      }
      if (mode === "edit") {
        await updateShell(initialAasId!, body);
        toast.success(t.twins.msg.updated(idShort));
      } else {
        await createShell(body);
        toast.success(t.twins.msg.created(idShort));
      }
      reset();
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SlidePanel open={open} onClose={() => { reset(); onClose(); }} closeDisabled={submitting} className="max-w-xl">
      {/* Header */}
      <div className="flex items-center px-6 pt-5 pb-4 pr-10 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <BookMarked className="w-5 h-5 text-primary flex-shrink-0" />
          <p className="text-[15px] font-semibold text-foreground truncate">
            {mode === "edit" ? t.twins.edit : t.twins.create}
          </p>
        </div>
      </div>

      {/* Body */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center py-10 gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-[13px]">{t.common.loading}</span>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3.5">
          {/* Asset Administration Shell Descriptor */}
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold border-b border-border pb-1">
            Asset Administration Shell Descriptor
          </div>
          <FormField label={t.twins.form.idShort} required>
            <input
              value={idShort}
              onChange={(e) => setIdShort(e.target.value)}
              placeholder="MyShell"
              disabled={submitting}
              className={inputBase}
            />
          </FormField>
          <FormField label={t.twins.form.aasId} required hint={mode === "edit" ? t.twins.aasIdImmutable : undefined}>
            <div className="relative">
              {mode === "edit" && <Lock className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />}
              <input
                value={aasId}
                onChange={(e) => setAasId(e.target.value)}
                placeholder="urn:uuid:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                disabled={mode === "edit" || submitting}
                className={cn(inputBase, "mono placeholder:font-sans placeholder:font-normal", mode === "edit" && "pl-8")}
              />
            </div>
          </FormField>
          <FormField label={t.twins.form.globalAssetId}>
            <input
              value={globalAssetId}
              onChange={(e) => setGlobalAssetId(e.target.value)}
              placeholder="urn:uuid:..."
              disabled={submitting}
              className={`${inputBase} mono placeholder:font-sans placeholder:font-normal`}
            />
          </FormField>
          <FormField label={t.twins.form.descriptionKo}>
            <input
              value={descriptionKo}
              onChange={(e) => setDescriptionKo(e.target.value)}
              lang="ko"
              disabled={submitting}
              className={inputBase}
            />
          </FormField>
          <FormField label={t.twins.form.descriptionEn}>
            <input
              value={descriptionEn}
              onChange={(e) => setDescriptionEn(e.target.value)}
              lang="en"
              disabled={submitting}
              className={inputBase}
            />
          </FormField>

          {/* Specific AssetId[] */}
          <div className="pt-2">
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
                Specific AssetId
              </label>
              <button
                onClick={() => setSpecs([...specs, { name: "", value: "" }])}
                disabled={submitting}
                className="inline-flex items-center gap-1 h-7 text-[11px] px-2.5 rounded-md border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
              >
                <Plus className="w-3 h-3" /> {t.twins.form.addSpecificAssetId}
              </button>
            </div>
            <div className="space-y-1.5">
              {specs.map((s, i) => (
                <div key={i} className="flex gap-1.5 items-center">
                  <input
                    placeholder={t.twins.form.keyName}
                    value={s.name}
                    disabled={submitting}
                    onChange={(e) => { const n = [...specs]; n[i] = { ...n[i], name: e.target.value }; setSpecs(n); }}
                    className={`${inputBase} flex-1`}
                  />
                  <input
                    placeholder={t.twins.form.keyValue}
                    value={s.value}
                    disabled={submitting}
                    onChange={(e) => { const n = [...specs]; n[i] = { ...n[i], value: e.target.value }; setSpecs(n); }}
                    className={`${inputBase} flex-1`}
                  />
                  <button
                    onClick={() => setSpecs(specs.filter((_, j) => j !== i))}
                    aria-label={t.common.delete}
                    disabled={submitting}
                    className="text-muted-foreground hover:text-rose-600 disabled:opacity-50 focus:outline-none focus-visible:ring-1 focus-visible:ring-rose-400 rounded"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Submodel Descriptor[] */}
          <div className="pt-2 border-t border-border">
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
                Submodel Descriptor
              </label>
              <button
                onClick={() => setSubs([...subs, newSubmodel()])}
                disabled={submitting}
                className="inline-flex items-center gap-1 h-7 text-[11px] px-2.5 rounded-md border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
              >
                <Plus className="w-3 h-3" /> {t.twins.form.addSubmodel}
              </button>
            </div>
            <div className="space-y-3">
              {subs.map((s, si) => (
                <SubmodelFormFields
                  key={si}
                  submodel={s}
                  index={si}
                  showDescription={false}
                  disabled={submitting}
                  onChange={(next) => { const n = [...subs]; n[si] = next; setSubs(n); }}
                  onRemove={() => setSubs(subs.filter((_, j) => j !== si))}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="flex justify-end gap-2 px-5 py-3 border-t border-border bg-muted/20 flex-shrink-0">
        <button
          onClick={() => { reset(); onClose(); }}
          disabled={submitting}
          className="inline-flex items-center justify-center gap-1.5 h-8 px-3 text-sm rounded-md border border-border hover:bg-muted text-foreground/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
        >
          <X className="w-3.5 h-3.5" />
          {t.twins.form.cancel}
        </button>
        <PrimaryActionButton
          onClick={submit}
          disabled={submitting || loading}
          icon={submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : undefined}
        >
          {mode === "edit" ? t.twins.form.update : t.twins.form.submit}
        </PrimaryActionButton>
      </div>
    </SlidePanel>
  );
}
