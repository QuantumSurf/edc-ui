// Connector Hub — Digital Twin Registry (Tractus-X DTR)
// Lists Shell Descriptors and supports create/delete; submodels shown inline in detail dialog.

import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { fetchShells, createShell, updateShell, deleteShell, fetchShellRaw } from "@/services";
import type { ShellDescriptor, SpecificAssetId } from "@/lib/data";
import { Card, Badge, MonoText, SectionHdr, FormField } from "@/components/ui-kmx";
import { Pagination, paginate } from "@/components/Pagination";
import { Boxes, PlusCircle, Trash2, Search, RefreshCw, Loader2, AlertCircle, Copy, X, Pencil, FileJson, Download } from "lucide-react";
import { RoleGate } from "@/components/RoleGate";
import {
  type SubmodelInput,
  newSubmodel,
  submodelInputToBody,
  rawSubmodelToInput,
  SubmodelFormFields,
  EndpointDetail,
} from "@/components/SubmodelForm";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";

export default function PageShells() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<ShellDescriptor | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ShellDescriptor | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<"create" | "edit">("create");
  const [editorAasId, setEditorAasId] = useState<string | undefined>(undefined);
  const [jsonView, setJsonView] = useState<ShellDescriptor | null>(null);

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

  const onDeleted = async () => {
    if (!deleteTarget) return;
    try {
      await deleteShell(deleteTarget.id);
      toast.success(deleteTarget.idShort + " 삭제됨");
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: ["shells"] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <>
      <SectionHdr
        breadcrumb={t.twins.subtitle}
        action={
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded border border-border hover:bg-muted disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${isFetching ? "animate-spin" : ""}`} />
              {t.twins.refresh}
            </button>
            <RoleGate permission="resource:write">
              <button
                onClick={() => { setEditorMode("create"); setEditorAasId(undefined); setEditorOpen(true); }}
                className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded bg-primary hover:bg-primary/90 text-primary-foreground font-medium"
              >
                <PlusCircle className="w-3 h-3" />
                {t.twins.create}
              </button>
            </RoleGate>
          </div>
        }
      >
        {t.twins.title}
      </SectionHdr>

      {/* Search */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder={t.twins.searchPlaceholder}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full pl-8 pr-3 py-1.5 text-[12px] border border-border rounded-md bg-card focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <span className="text-[11px] text-muted-foreground ml-auto">
          {t.twins.resultCount(filtered.length, shells.length)}
        </span>
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

      {/* Empty */}
      {!isLoading && !isError && shells.length === 0 && (
        <Card>
          <div className="flex flex-col items-center justify-center py-10 gap-2 text-muted-foreground">
            <Boxes className="w-6 h-6" />
            <span className="text-[13px]">{t.twins.empty}</span>
          </div>
        </Card>
      )}

      {/* Table */}
      {!isLoading && !isError && shells.length > 0 && (
        <Card noPad>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  {[
                    t.twins.col.idShort,
                    t.twins.col.aasId,
                    t.twins.col.globalAssetId,
                    t.twins.col.specificAssetIds,
                    t.twins.col.submodels,
                  ].map((h) => (
                    <th key={h} style={{ textTransform: "none" }} className="text-left !text-[12px] px-4 py-3 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {paginate(filtered, page).map((s) => (
                  <tr key={s.id} onClick={() => setDetail(s)} className="hover:bg-muted/30 cursor-pointer">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Boxes className="w-4 h-4 text-blue-500 flex-shrink-0" />
                        <span className="!text-[12px] truncate">{s.idShort || "—"}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <MonoText className="!text-[11px] !font-normal text-muted-foreground truncate max-w-[260px] inline-block">{s.id}</MonoText>
                    </td>
                    <td className="px-4 py-3">
                      <MonoText className="!text-[11px] !font-normal text-muted-foreground truncate max-w-[260px] inline-block">{s.globalAssetId || "—"}</MonoText>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {s.specificAssetIds.slice(0, 2).map((sa, i) => (
                          <Badge key={i} variant="gray">{sa.name}={sa.value}</Badge>
                        ))}
                        {s.specificAssetIds.length > 2 && (
                          <span className="text-[10px] text-muted-foreground">+{s.specificAssetIds.length - 2}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={s.submodelCount > 0 ? "blue" : "gray"}>{s.submodelCount}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination total={filtered.length} page={page} onPageChange={setPage} />
        </Card>
      )}

      {/* Detail dialog */}
      <ShellDetailDialog
        shell={detail}
        onClose={() => setDetail(null)}
        onEdit={() => { if (detail) { setEditorMode("edit"); setEditorAasId(detail.id); setEditorOpen(true); setDetail(null); } }}
        onDelete={() => { setDeleteTarget(detail); setDetail(null); }}
        onViewJson={() => { if (detail) { setJsonView(detail); setDetail(null); } }}
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
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.twins.delete.title}</AlertDialogTitle>
            <AlertDialogDescription>{t.twins.delete.message}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex justify-end gap-2 mt-4">
            <AlertDialogCancel>{t.twins.form.cancel}</AlertDialogCancel>
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
function ShellDetailDialog({
  shell, onClose, onEdit, onDelete, onViewJson,
}: { shell: ShellDescriptor | null; onClose: () => void; onEdit: () => void; onDelete: () => void; onViewJson: () => void }) {
  const { t } = useI18n();
  if (!shell) return null;
  const copy = (s: string) => { navigator.clipboard.writeText(s); toast.success(t.common.copied); };
  return (
    <Dialog open={!!shell} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader className="min-w-0">
          <DialogTitle className="flex items-center gap-2 min-w-0">
            <Boxes className="w-4 h-4 text-blue-500 flex-shrink-0" />
            <span className="truncate">{shell.idShort || t.twins.detail.title}</span>
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-[12px] min-w-0">
          <Field label={t.twins.col.aasId} value={shell.id} mono onCopy={copy} />
          <Field label={t.twins.col.globalAssetId} value={shell.globalAssetId} mono onCopy={copy} />
          {(shell.descriptions ?? []).length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                {t.twins.form.description}
              </div>
              <div className="space-y-1">
                {(shell.descriptions ?? []).map((d, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <Badge variant="gray">{d.language || "—"}</Badge>
                    <span className="flex-1 break-words">{d.text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
              {t.twins.col.specificAssetIds}
            </div>
            {shell.specificAssetIds.length === 0
              ? <span className="text-muted-foreground">—</span>
              : <div className="flex flex-wrap gap-1">
                  {shell.specificAssetIds.map((sa, i) => (
                    <Badge key={i} variant="gray">{sa.name}={sa.value}</Badge>
                  ))}
                </div>}
          </div>

          <div className="pt-2 border-t border-border">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">
              {t.twins.detail.submodels}
            </div>
            {shell.submodelDescriptors.length === 0
              ? <span className="text-muted-foreground">{t.twins.detail.noSubmodels}</span>
              : <ul className="space-y-2 min-w-0">
                  {shell.submodelDescriptors.map((sub) => (
                    <li key={sub.id} className="p-2 rounded bg-muted/40 border border-border space-y-2 min-w-0 overflow-hidden">
                      <div className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium">{sub.idShort}</div>
                          <MonoText className="!text-[11px] !font-normal text-muted-foreground truncate block">{sub.id}</MonoText>
                          {sub.semanticId && (
                            <MonoText className="!text-[11px] !font-normal text-muted-foreground truncate block">semanticId: {sub.semanticId}</MonoText>
                          )}
                        </div>
                        <Badge variant="blue">{sub.endpointCount} ep</Badge>
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
          </div>
        </div>

        <div className="flex justify-between items-center gap-2 pt-3 border-t border-border mt-2">
          <button
            onClick={onViewJson}
            className="flex items-center gap-1 text-[12px] px-3 py-1.5 rounded border border-border hover:bg-muted"
          >
            <FileJson className="w-3 h-3" />
            {t.twins.detail.viewJson}
          </button>
          <RoleGate permission="resource:write">
            <div className="flex gap-2">
              <button
                onClick={onEdit}
                className="flex items-center gap-1 text-[12px] px-3 py-1.5 rounded border border-border hover:bg-muted"
              >
                <Pencil className="w-3 h-3" />
                {t.common.edit}
              </button>
              <button
                onClick={onDelete}
                className="flex items-center gap-1 text-[12px] px-3 py-1.5 rounded border border-rose-200 text-rose-600 hover:bg-rose-50"
              >
                <Trash2 className="w-3 h-3" />
                {t.common.delete}
              </button>
            </div>
          </RoleGate>
        </div>
      </DialogContent>
    </Dialog>
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
  const formatted = raw ? JSON.stringify(raw, null, 2) : "";
  const copy = () => { navigator.clipboard.writeText(formatted); toast.success(t.common.copied); };
  const download = () => {
    const blob = new Blob([formatted], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safe = (shell.idShort || "shell").replace(/[^a-z0-9._-]/gi, "_");
    a.href = url;
    a.download = `${safe}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={!!shell} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileJson className="w-4 h-4 text-blue-500" />
            {t.twins.detail.jsonTitle}
            <Badge variant="gray">{shell.idShort}</Badge>
          </DialogTitle>
          <p className="text-[11px] text-muted-foreground">{t.twins.detail.jsonDesc}</p>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          {loading ? (
            <div className="flex items-center justify-center py-10 gap-2 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-[13px]">{t.common.loading}</span>
            </div>
          ) : (
            <pre className="flex-1 min-h-0 overflow-auto bg-muted/40 border border-border rounded p-3 text-[11px] mono leading-relaxed whitespace-pre">
              {formatted}
            </pre>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t border-border">
          <button
            onClick={copy}
            disabled={loading || !raw}
            className="flex items-center gap-1 text-[12px] px-3 py-1.5 rounded border border-border hover:bg-muted disabled:opacity-50"
          >
            <Copy className="w-3 h-3" />
            {t.twins.detail.copyJson}
          </button>
          <button
            onClick={download}
            disabled={loading || !raw}
            className="flex items-center gap-1 text-[12px] px-3 py-1.5 rounded border border-border hover:bg-muted disabled:opacity-50"
          >
            <Download className="w-3 h-3" />
            {t.twins.detail.downloadJson}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value, mono, onCopy }: {
  label: string; value: string; mono?: boolean; onCopy?: (s: string) => void;
}) {
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
            className="opacity-0 group-hover:opacity-100 flex-shrink-0 mt-0.5"
          >
            <Copy className="w-3 h-3 text-muted-foreground hover:text-foreground" />
          </button>
        )}
      </div>
    </div>
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
          if (!raw) { toast.error("Shell 정보를 불러올 수 없습니다."); return; }
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
      toast.error("AAS ID 와 idShort 는 필수입니다.");
      return;
    }
    for (const s of subs) {
      if (!s.id || !s.idShort) {
        toast.error("Submodel 은 ID 와 idShort 가 필수입니다.");
        return;
      }
      for (const ep of s.endpoints) {
        if (!ep.protocolInformation.href) {
          toast.error("Endpoint 는 Protocol Information.href 가 필수입니다.");
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
        toast.success(idShort + " 수정됨");
      } else {
        await createShell(body);
        toast.success(idShort + " 등록됨");
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
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <DialogContent
        className="max-w-2xl max-h-[85vh] overflow-y-auto"
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PlusCircle className="w-4 h-4" />
            {mode === "edit" ? t.twins.edit : t.twins.create}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10 gap-2 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-[13px]">{t.common.loading}</span>
          </div>
        ) : (
        <div className="space-y-3">
          {/* Asset Administration Shell Descriptor */}
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold border-b border-border pb-1">
            Asset Administration Shell Descriptor
          </div>
          <FormField label={t.twins.form.idShort} required>
            <input
              value={idShort}
              onChange={(e) => setIdShort(e.target.value)}
              placeholder="MyShell"
              className="w-full px-2 py-1.5 text-[12px] border border-border rounded-md bg-card"
            />
          </FormField>
          <FormField label={t.twins.form.aasId} required>
            <input
              value={aasId}
              onChange={(e) => setAasId(e.target.value)}
              placeholder="urn:uuid:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              disabled={mode === "edit"}
              className="w-full px-2 py-1.5 text-[12px] mono border border-border rounded-md bg-card disabled:opacity-60 disabled:cursor-not-allowed"
            />
          </FormField>
          <FormField label={t.twins.form.globalAssetId}>
            <input
              value={globalAssetId}
              onChange={(e) => setGlobalAssetId(e.target.value)}
              placeholder="urn:uuid:..."
              className="w-full px-2 py-1.5 text-[12px] mono border border-border rounded-md bg-card"
            />
          </FormField>
          <FormField label={t.twins.form.descriptionKo}>
            <input
              value={descriptionKo}
              onChange={(e) => setDescriptionKo(e.target.value)}
              lang="ko"
              className="w-full px-2 py-1.5 text-[12px] border border-border rounded-md bg-card"
            />
          </FormField>
          <FormField label={t.twins.form.descriptionEn}>
            <input
              value={descriptionEn}
              onChange={(e) => setDescriptionEn(e.target.value)}
              lang="en"
              className="w-full px-2 py-1.5 text-[12px] border border-border rounded-md bg-card"
            />
          </FormField>

          {/* Specific AssetId[] */}
          <div className="pt-2">
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
                Specific AssetId
              </label>
              <button
                onClick={() => setSpecs([...specs, { name: "", value: "" }])}
                className="text-[11px] text-primary hover:underline"
              >
                + {t.twins.form.addSpecificAssetId}
              </button>
            </div>
            <div className="space-y-1.5">
              {specs.map((s, i) => (
                <div key={i} className="flex gap-1.5 items-center">
                  <input
                    placeholder={t.twins.form.keyName}
                    value={s.name}
                    onChange={(e) => { const n = [...specs]; n[i] = { ...n[i], name: e.target.value }; setSpecs(n); }}
                    className="flex-1 px-2 py-1 text-[11px] border border-border rounded bg-card"
                  />
                  <input
                    placeholder={t.twins.form.keyValue}
                    value={s.value}
                    onChange={(e) => { const n = [...specs]; n[i] = { ...n[i], value: e.target.value }; setSpecs(n); }}
                    className="flex-1 px-2 py-1 text-[11px] border border-border rounded bg-card"
                  />
                  <button
                    onClick={() => setSpecs(specs.filter((_, j) => j !== i))}
                    className="text-muted-foreground hover:text-rose-600"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Submodel Descriptor[] */}
          <div className="pt-2 border-t border-border">
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
                Submodel Descriptor
              </label>
              <button
                onClick={() => setSubs([...subs, newSubmodel()])}
                className="text-[11px] text-primary hover:underline"
              >
                + {t.twins.form.addSubmodel}
              </button>
            </div>
            <div className="space-y-3">
              {subs.map((s, si) => (
                <SubmodelFormFields
                  key={si}
                  submodel={s}
                  index={si}
                  showDescription={false}
                  onChange={(next) => { const n = [...subs]; n[si] = next; setSubs(n); }}
                  onRemove={() => setSubs(subs.filter((_, j) => j !== si))}
                />
              ))}
            </div>
          </div>
        </div>
        )}

        <div className="flex justify-end gap-2 pt-3 border-t border-border mt-3">
          <button
            onClick={() => { reset(); onClose(); }}
            className="text-[12px] px-3 py-1.5 rounded border border-border hover:bg-muted"
          >
            {t.twins.form.cancel}
          </button>
          <button
            onClick={submit}
            disabled={submitting || loading}
            className="flex items-center gap-1 text-[12px] px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {submitting && <Loader2 className="w-3 h-3 animate-spin" />}
            {mode === "edit" ? t.twins.form.update : t.twins.form.submit}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
