// Connector Hub — Semantic Models (Tractus-X SAMM, local Postgres CRUD)

import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import {
  fetchSemanticModels, fetchSemanticModel,
  createSemanticModel, updateSemanticModel, deleteSemanticModel,
} from "@/services";
import type { SemanticModel, SemanticModelStatus, SemanticModelSummary } from "@/lib/data";
import {
  Card, Badge, MonoText, SectionHdr, FormField,
  ListCard, ListHeaderRow, ListRow, ListColLabel, ListEmpty,
} from "@/components/ui-kmx";

const SUBMODEL_COLS = "grid-cols-[1.4fr_2fr_0.7fr_0.9fr_0.9fr_0.7fr_1.1fr]";
import { DataTablePagination, usePagination } from "@/components/DataTablePagination";
import { SlidePanel } from "@/components/DetailDeleteDialogs";
import { RoleGate } from "@/components/RoleGate";
import {
  Layers, Search, RefreshCw, Loader2, AlertCircle,
  PlusCircle, Pencil, Trash2, Copy, Download, Shapes, X,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";

const STATUSES: SemanticModelStatus[] = ["DRAFT", "RELEASED", "STANDARDIZED", "DEPRECATED"];
const STATUS_VARIANT: Record<SemanticModelStatus, "gray" | "blue" | "green" | "amber"> = {
  DRAFT: "gray",
  RELEASED: "blue",
  STANDARDIZED: "green",
  DEPRECATED: "amber",
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export default function PageSubmodels() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [detailUrn, setDetailUrn] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SemanticModelSummary | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<"create" | "edit">("create");
  const [editorUrn, setEditorUrn] = useState<string | null>(null);

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["semantic-models"],
    queryFn: () => fetchSemanticModels(),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchInterval: false,
  });
  const items = data?.items ?? [];

  const filtered = items.filter((m) => {
    const q = search.toLowerCase();
    if (!q) return true;
    return (
      m.urn.toLowerCase().includes(q) ||
      m.name.toLowerCase().includes(q) ||
      (m.descriptionKo ?? "").toLowerCase().includes(q) ||
      (m.descriptionEn ?? "").toLowerCase().includes(q)
    );
  });

  const { paginatedData, totalItems, currentPage, pageSize, setCurrentPage, setPageSize } = usePagination(filtered, 10);

  const onDeleted = async () => {
    if (!deleteTarget) return;
    try {
      await deleteSemanticModel(deleteTarget.urn);
      toast.success(t.submodels.msg.deleted(deleteTarget.name));
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: ["semantic-models"] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <>
      <SectionHdr
        icon={<Shapes className="w-5 h-5 text-primary" />}
        breadcrumb={t.submodels.subtitle}
        action={
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded border border-border hover:bg-muted disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${isFetching ? "animate-spin" : ""}`} />
              {t.submodels.refresh}
            </button>
            <RoleGate permission="resource:write">
              <button
                onClick={() => { setEditorMode("create"); setEditorUrn(null); setEditorOpen(true); }}
                className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded bg-primary hover:bg-primary/90 text-primary-foreground font-medium"
              >
                <PlusCircle className="w-3 h-3" />
                {t.submodels.create}
              </button>
            </RoleGate>
          </div>
        }
      >
        {t.submodels.title}
      </SectionHdr>

      {/* Search & Filter — fl-aggregator TasksPage style */}
      <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder={t.submodels.searchPlaceholder}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setCurrentPage(1); }}
            className="w-full pl-8 pr-3 py-1.5 text-[12px] border border-border rounded-md bg-card text-foreground placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      {isLoading && (
        <Card>
          <div className="flex items-center justify-center py-10 gap-2 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-[13px]">{t.common.loading}</span>
          </div>
        </Card>
      )}

      {!isLoading && isError && (
        <Card>
          <div className="flex flex-col items-center justify-center py-10 gap-3">
            <div className="flex items-center gap-2 text-rose-600">
              <AlertCircle className="w-4 h-4" />
              <span className="text-[13px] font-medium">{t.common.loadFailed}</span>
            </div>
            <button
              onClick={() => refetch()}
              className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-md border border-border hover:bg-muted"
            >
              <RefreshCw className="w-3 h-3" />
              {t.common.retry}
            </button>
          </div>
        </Card>
      )}

      {!isLoading && !isError && items.length === 0 && (
        <Card>
          <div className="flex flex-col items-center justify-center py-10 gap-2 text-muted-foreground">
            <Layers className="w-6 h-6" />
            <span className="text-[13px]">{t.submodels.empty}</span>
          </div>
        </Card>
      )}

      {!isLoading && !isError && items.length > 0 && (
        <ListCard
          title={t.submodels.listTitle}
        >
          <ListHeaderRow cols={SUBMODEL_COLS}>
            <ListColLabel>{t.submodels.col.name}</ListColLabel>
            <ListColLabel>{t.submodels.col.urn}</ListColLabel>
            <ListColLabel>{t.submodels.col.version}</ListColLabel>
            <ListColLabel>{t.submodels.col.status}</ListColLabel>
            <ListColLabel className="hidden lg:block">{t.submodels.col.modelType}</ListColLabel>
            <ListColLabel className="hidden xl:block">{t.submodels.col.size}</ListColLabel>
            <ListColLabel className="hidden xl:block">{t.submodels.col.updated}</ListColLabel>
          </ListHeaderRow>
          {filtered.length === 0 ? (
            <ListEmpty icon={<Layers />} message={t.submodels.noSearchResults} />
          ) : (
            paginatedData.map((m) => (
              <ListRow key={m.urn} cols={SUBMODEL_COLS} onClick={() => setDetailUrn(m.urn)}>
                <div className="min-w-0">
                  <span className="text-[12px] font-medium text-primary group-hover:text-primary/80 truncate block">{m.name}</span>
                </div>
                <div className="min-w-0">
                  <MonoText className="!text-[12px] !font-normal text-muted-foreground truncate block">{m.urn}</MonoText>
                </div>
                <div>
                  <MonoText className="!text-[12px] !font-normal">{m.version || "—"}</MonoText>
                </div>
                <div>
                  <Badge variant={STATUS_VARIANT[m.status]}>{m.status}</Badge>
                </div>
                <div className="hidden lg:block">
                  <span className="text-[12px] font-normal">{m.modelType}</span>
                </div>
                <div className="hidden xl:block">
                  <span className="text-[12px] font-normal text-muted-foreground">{formatBytes(m.contentBytes)}</span>
                </div>
                <div className="hidden xl:block min-w-0">
                  <span className="text-[12px] font-normal text-muted-foreground truncate block">{formatDate(m.updatedAt)}</span>
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
      <SemanticModelDetailDialog
        urn={detailUrn}
        onClose={() => setDetailUrn(null)}
        onEdit={() => {
          if (!detailUrn) return;
          setEditorMode("edit");
          setEditorUrn(detailUrn);
          setEditorOpen(true);
          setDetailUrn(null);
        }}
        onDelete={(summary) => { setDeleteTarget(summary); setDetailUrn(null); }}
      />

      {/* Editor dialog */}
      <SemanticModelEditorDialog
        open={editorOpen}
        mode={editorMode}
        initialUrn={editorUrn}
        onClose={() => setEditorOpen(false)}
        onSaved={() => { setEditorOpen(false); qc.invalidateQueries({ queryKey: ["semantic-models"] }); }}
      />

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.submodels.delete.title}</AlertDialogTitle>
            <AlertDialogDescription>{t.submodels.delete.message}</AlertDialogDescription>
          </AlertDialogHeader>
          {deleteTarget && (
            <div className="text-[12px] text-muted-foreground">
              <div><strong className="text-foreground">{deleteTarget.name}</strong></div>
              <MonoText className="!text-[11px] block break-all">{deleteTarget.urn}</MonoText>
            </div>
          )}
          <div className="flex justify-end gap-2 mt-4">
            <AlertDialogCancel>{t.submodels.form.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={onDeleted} className="bg-rose-600 hover:bg-rose-700">
              {t.common.delete}
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/* ─── Detail dialog ──────────────────────────────────────────── */
function SemanticModelDetailDialog({
  urn, onClose, onEdit, onDelete,
}: {
  urn: string | null;
  onClose: () => void;
  onEdit: () => void;
  onDelete: (summary: SemanticModelSummary) => void;
}) {
  const { t } = useI18n();
  const [model, setModel] = useState<SemanticModel | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!urn) { setModel(null); return; }
    setLoading(true);
    fetchSemanticModel(urn)
      .then((data) => setModel(data))
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setLoading(false));
  }, [urn]);

  if (!urn) return null;
  const copy = (s: string, label?: string) => {
    navigator.clipboard.writeText(s);
    toast.success(label ?? t.common.copied);
  };
  const downloadContent = () => {
    if (!model) return;
    const blob = new Blob([model.content], { type: "text/turtle" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safe = (model.name || "model").replace(/[^a-z0-9._-]/gi, "_");
    a.href = url;
    a.download = `${safe}-${model.version || "v"}.ttl`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <SlidePanel open={!!urn} onClose={onClose}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border bg-muted/30 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Layers className="w-4 h-4 text-violet-500 flex-shrink-0" />
          <p className="font-display text-[14px] font-bold text-foreground truncate">{model?.name ?? t.submodels.detail.title}</p>
          {model && <Badge variant={STATUS_VARIANT[model.status]}>{model.status}</Badge>}
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
          aria-label={t.common.close}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      {loading || !model ? (
        <div className="flex-1 flex items-center justify-center py-10 gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-[13px]">{t.common.loading}</span>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4">
          <div className="space-y-3 text-[12px] min-w-0">
            <DetailRow label="URN" value={model.urn} mono onCopy={(s) => copy(s, t.submodels.detail.copyUrn)} />
            <DetailRow label={t.submodels.col.version} value={model.version || "—"} mono />
            <DetailRow label={t.submodels.col.modelType} value={model.modelType} />
            {model.descriptionKo && (
              <DetailRow label={t.submodels.form.descriptionKo} value={model.descriptionKo} />
            )}
            {model.descriptionEn && (
              <DetailRow label={t.submodels.form.descriptionEn} value={model.descriptionEn} />
            )}
            <DetailRow label="Created" value={formatDate(model.createdAt)} />
            <DetailRow label="Updated" value={formatDate(model.updatedAt)} />

            <div className="pt-2 border-t border-border min-w-0">
              <div className="flex items-center justify-between mb-1">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {t.submodels.detail.content}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => copy(model.content)}
                    disabled={!model.content}
                    className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border border-border hover:bg-muted disabled:opacity-50"
                  >
                    <Copy className="w-3 h-3" />
                    {t.submodels.detail.copyContent}
                  </button>
                  <button
                    onClick={downloadContent}
                    disabled={!model.content}
                    className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border border-border hover:bg-muted disabled:opacity-50"
                  >
                    <Download className="w-3 h-3" />
                    {t.submodels.detail.downloadContent}
                  </button>
                </div>
              </div>
              {model.content ? (
                <pre className="max-h-[40vh] overflow-auto bg-muted/40 border border-border rounded p-3 text-[11px] mono leading-relaxed whitespace-pre">
                  {model.content}
                </pre>
              ) : (
                <div className="text-[12px] text-muted-foreground py-4 text-center">
                  {t.submodels.detail.noContent}
                </div>
              )}
            </div>
          </div>
        </div>
        )}

      {/* Footer */}
      <RoleGate permission="resource:write">
          <div className="flex justify-end gap-2 px-3 py-2.5 border-t border-border bg-muted/20 flex-shrink-0">
            <button
              onClick={onEdit}
              disabled={!model}
              className="flex items-center gap-1 text-[12px] px-3 py-1.5 rounded border border-border hover:bg-muted disabled:opacity-50"
            >
              <Pencil className="w-3 h-3" />
              {t.common.edit}
            </button>
            <button
              onClick={() => model && onDelete({
                urn: model.urn, name: model.name, version: model.version, status: model.status,
                modelType: model.modelType, descriptionKo: model.descriptionKo, descriptionEn: model.descriptionEn,
                contentBytes: model.content?.length ?? 0, createdAt: model.createdAt, updatedAt: model.updatedAt,
              })}
              disabled={!model}
              className="flex items-center gap-1 text-[12px] px-3 py-1.5 rounded border border-rose-200 text-rose-600 hover:bg-rose-50 disabled:opacity-50"
            >
              <Trash2 className="w-3 h-3" />
              {t.common.delete}
            </button>
          </div>
        </RoleGate>
    </SlidePanel>
  );
}

function DetailRow({ label, value, mono, onCopy }: {
  label: string; value: string; mono?: boolean; onCopy?: (s: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">{label}</div>
      <div className="flex items-start gap-2 group min-w-0">
        {mono
          ? <MonoText className="!text-[12px] !font-normal break-all flex-1 min-w-0">{value || "—"}</MonoText>
          : <span className="flex-1 break-words min-w-0">{value || "—"}</span>}
        {onCopy && value && (
          <button
            onClick={() => onCopy(value)}
            className="opacity-60 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-0.5 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded"
            aria-label={t.common.copy ?? "Copy"}
          >
            <Copy className="w-3 h-3 text-muted-foreground hover:text-foreground" />
          </button>
        )}
      </div>
    </div>
  );
}

/* ─── Editor dialog (create + edit) ──────────────────────────── */
function SemanticModelEditorDialog({
  open, mode, initialUrn, onClose, onSaved,
}: {
  open: boolean;
  mode: "create" | "edit";
  initialUrn: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [urn, setUrn] = useState("");
  const [name, setName] = useState("");
  const [version, setVersion] = useState("");
  const [status, setStatus] = useState<SemanticModelStatus>("DRAFT");
  const [modelType, setModelType] = useState("SAMM");
  const [content, setContent] = useState("");
  const [descriptionKo, setDescriptionKo] = useState("");
  const [descriptionEn, setDescriptionEn] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(false);

  const reset = () => {
    setUrn(""); setName(""); setVersion(""); setStatus("DRAFT"); setModelType("SAMM");
    setContent(""); setDescriptionKo(""); setDescriptionEn("");
  };

  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && initialUrn) {
      setLoading(true);
      fetchSemanticModel(initialUrn)
        .then((m) => {
          setUrn(m.urn);
          setName(m.name);
          setVersion(m.version);
          setStatus(m.status);
          setModelType(m.modelType);
          setContent(m.content);
          setDescriptionKo(m.descriptionKo);
          setDescriptionEn(m.descriptionEn);
        })
        .catch((e) => toast.error((e as Error).message))
        .finally(() => setLoading(false));
    } else {
      reset();
    }
  }, [open, mode, initialUrn]);

  const submit = async () => {
    if (!urn.trim()) { toast.error(t.submodels.form.urnRequired); return; }
    if (!name.trim()) { toast.error(t.submodels.form.nameRequired); return; }
    setSubmitting(true);
    try {
      const body: Partial<SemanticModel> = {
        urn: urn.trim(),
        name: name.trim(),
        version,
        status,
        modelType,
        content,
        descriptionKo,
        descriptionEn,
      };
      if (mode === "edit" && initialUrn) {
        await updateSemanticModel(initialUrn, body);
        toast.success(t.submodels.msg.updated(name));
      } else {
        await createSemanticModel(body);
        toast.success(t.submodels.msg.created(name));
      }
      reset();
      onSaved();
    } catch (e) {
      const err = e as { response?: { status?: number; data?: { error?: string } }; message?: string };
      const serverMsg = err.response?.data?.error;
      if (serverMsg === "duplicate-urn") {
        toast.error(t.submodels.form.duplicateUrn);
      } else if (serverMsg) {
        toast.error(serverMsg);
      } else if (err.response?.status === 413) {
        toast.error(t.submodels.msg.tooLarge);
      } else {
        toast.error(err.message ?? t.submodels.msg.saveFailed);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SlidePanel open={open} onClose={() => { reset(); onClose(); }} className="max-w-xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border bg-muted/30 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <PlusCircle className="w-4 h-4 text-blue-500 flex-shrink-0" />
          <p className="font-display text-[14px] font-bold text-foreground truncate">
            {mode === "edit" ? t.submodels.edit : t.submodels.create}
          </p>
        </div>
        <button
          onClick={() => { reset(); onClose(); }}
          className="p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
          aria-label={t.common.close}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Body */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center py-10 gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-[13px]">{t.common.loading}</span>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4 space-y-3 min-w-0">
            <FormField label={t.submodels.form.urn} required hint={t.submodels.form.urnHint}>
              <input
                value={urn}
                onChange={(e) => setUrn(e.target.value)}
                disabled={mode === "edit"}
                placeholder="urn:samm:io.catenax.pcf:7.0.0#Pcf"
                className="w-full px-2.5 py-1.5 text-[12px] mono border border-border rounded-md bg-card text-foreground placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60 disabled:cursor-not-allowed"
              />
            </FormField>
            <FormField label={t.submodels.form.name} required>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Pcf"
                className="w-full px-2.5 py-1.5 text-[12px] border border-border rounded-md bg-card text-foreground placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </FormField>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 min-w-0">
              <FormField label={t.submodels.form.version} hint={t.submodels.form.versionHint}>
                <input
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  placeholder="7.0.0"
                  className="w-full px-2.5 py-1.5 text-[12px] mono border border-border rounded-md bg-card text-foreground placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </FormField>
              <FormField label={t.submodels.form.status}>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as SemanticModelStatus)}
                  className="w-full px-2.5 py-1.5 text-[12px] border border-border rounded-md bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </FormField>
              <FormField label={t.submodels.form.modelType} hint={t.submodels.form.modelTypeHint}>
                <input
                  value={modelType}
                  onChange={(e) => setModelType(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-[12px] border border-border rounded-md bg-card text-foreground placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </FormField>
            </div>
            <FormField label={t.submodels.form.descriptionKo}>
              <input
                value={descriptionKo}
                onChange={(e) => setDescriptionKo(e.target.value)}
                lang="ko"
                className="w-full px-2.5 py-1.5 text-[12px] border border-border rounded-md bg-card text-foreground placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </FormField>
            <FormField label={t.submodels.form.descriptionEn}>
              <input
                value={descriptionEn}
                onChange={(e) => setDescriptionEn(e.target.value)}
                lang="en"
                className="w-full px-2.5 py-1.5 text-[12px] border border-border rounded-md bg-card text-foreground placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </FormField>
            <FormField label={t.submodels.form.content} hint={t.submodels.form.contentHint}>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={14}
                spellCheck={false}
                placeholder={`@prefix samm: <urn:samm:org.eclipse.esmf.samm:meta-model:2.1.0#> .\n@prefix : <urn:samm:io.catenax.pcf:7.0.0#> .\n\n:Pcf a samm:Aspect ;\n   samm:preferredName "PCF"@en ;\n   samm:properties ( ) ;\n   samm:operations ( ) .\n`}
                className="w-full px-2 py-1.5 text-[11px] mono border border-border rounded-md bg-card text-foreground placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-primary whitespace-pre overflow-auto"
                style={{ resize: "vertical" }}
              />
              <div className="text-[10px] text-muted-foreground text-right">
                {formatBytes(new Blob([content]).size)} / 256 KB
              </div>
            </FormField>
          </div>
      )}

      {/* Footer */}
      <div className="flex justify-end gap-2 px-3 py-2.5 border-t border-border bg-muted/20 flex-shrink-0">
        <button
          onClick={() => { reset(); onClose(); }}
          className="text-[12px] px-3 py-1.5 rounded border border-border hover:bg-muted"
        >
          {t.submodels.form.cancel}
        </button>
        <button
          onClick={submit}
          disabled={submitting || loading}
          className="flex items-center gap-1 text-[12px] px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {submitting && <Loader2 className="w-3 h-3 animate-spin" />}
          {mode === "edit" ? t.submodels.form.update : t.submodels.form.submit}
        </button>
      </div>
    </SlidePanel>
  );
}
