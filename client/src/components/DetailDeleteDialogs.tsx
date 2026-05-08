// KMX EDC — Reusable Detail + Delete Dialog Components
// Used by PageAssets, PagePolicy, PageOffering

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { useI18n } from "@/i18n";
import { Loader2, Pencil, Trash2, Copy, CheckCircle2, AlertTriangle, Files, Code, Download, X } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { MonoText } from "@/components/ui-kmx";

/* ─── Detail Dialog ──────────────────────────────────────────── */
interface DetailField {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  copyable?: boolean;
  /** Render value as syntax-highlighted JSON in a pre block */
  pre?: boolean;
  badge?: { text: string; variant: "blue" | "green" | "amber" | "gray" | "red" | "purple" };
}

interface DetailSection {
  title: string;
  fields: DetailField[];
}

interface DetailDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  /** Legacy flat field list */
  fields?: DetailField[];
  /** New: grouped sections */
  sections?: DetailSection[];
  onEdit?: () => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
  onShowJson?: () => void;
  /** When set, shows a disabled delete button with this tooltip text instead of hiding it */
  deleteDisabledReason?: string;
}

const BADGE_STYLES: Record<string, string> = {
  blue: "bg-blue-50 text-blue-700 border-blue-200",
  green: "bg-emerald-50 text-emerald-700 border-emerald-200",
  amber: "bg-amber-50 text-amber-700 border-amber-200",
  gray: "bg-gray-100 text-gray-600 border-gray-200",
  red: "bg-red-50 text-red-700 border-red-200",
  purple: "bg-purple-50 text-purple-700 border-purple-200",
};

function FieldValue({ field, idx, copied, onCopy }: { field: DetailField; idx: string; copied: string | null; onCopy: (text: string, key: string) => void }) {
  // Pre-formatted JSON block
  if (field.pre && field.value) {
    return (
      <div className="relative group/pre">
        <pre className="mono text-[12px] text-foreground/80 bg-muted/50 rounded-lg p-3 overflow-auto max-h-[240px] whitespace-pre-wrap leading-relaxed border border-border">
          {field.value}
        </pre>
        {field.copyable && (
          <button
            onClick={() => onCopy(String(field.value), idx)}
            className="absolute top-2 right-2 p-1 rounded-md bg-card border border-border opacity-0 group-hover/pre:opacity-100 transition-opacity"
          >
            {copied === idx
              ? <CheckCircle2 className="w-3 h-3 text-emerald-500" />
              : <Copy className="w-3 h-3 text-muted-foreground" />
            }
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 min-h-[24px]">
      {field.badge ? (
        <span className={`inline-flex items-center text-[12px] px-2 py-0.5 rounded-md border ${BADGE_STYLES[field.badge.variant]}`}>
          {field.badge.text}
        </span>
      ) : (
        <span className={`text-[12px] text-foreground leading-relaxed font-normal ${field.mono ? "mono bg-muted/60 px-2 py-1 rounded-md text-[12px] text-foreground break-all border border-border/40" : ""}`}>
          {field.value || <span className="text-muted-foreground/60 italic">N/A</span>}
        </span>
      )}
      {field.copyable && field.value && (
        <button
          onClick={() => onCopy(String(field.value), idx)}
          className="flex-shrink-0 p-0.5 rounded hover:bg-muted transition-colors"
        >
          {copied === idx
            ? <CheckCircle2 className="w-3 h-3 text-emerald-500" />
            : <Copy className="w-3 h-3 text-muted-foreground/50 hover:text-muted-foreground" />
          }
        </button>
      )}
    </div>
  );
}

export function DetailDialog({ open, onClose, title, subtitle, fields, sections, onEdit, onDelete, onDuplicate, onShowJson, deleteDisabledReason }: DetailDialogProps) {
  const { t } = useI18n();
  const [copied, setCopied] = useState<string | null>(null);

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  };

  // Support both legacy fields and new sections
  const renderSections = sections && sections.length > 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg p-0 overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-5 pb-4 border-b border-border">
          <DialogHeader>
            <DialogTitle className="font-display text-[15px] text-foreground font-semibold">{title}</DialogTitle>
            {subtitle && (
              <div className="flex items-center gap-2 mt-1.5">
                <span className="mono text-[12px] font-normal text-foreground bg-muted/60 border border-border/40 px-2 py-0.5 rounded-md">{subtitle}</span>
              </div>
            )}
          </DialogHeader>
        </div>

        {/* Content */}
        <div className="px-6 py-4 max-h-[60vh] overflow-y-auto">
          {renderSections ? (
            <div className="space-y-5">
              {sections.map((section, si) => (
                <div key={si}>
                  {/* Section header */}
                  <div className="mb-3">
                    <span className="text-[11px] font-bold text-muted-foreground/60 uppercase tracking-wider">{section.title}</span>
                    <div className="h-px bg-border mt-1.5" />
                  </div>
                  {/* Section fields */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {section.fields.map((f, fi) => (
                      <div key={fi} className={`flex flex-col gap-1 ${
                        f.pre || (f.mono && String(f.value ?? "").length > 30) ? "sm:col-span-2" : ""
                      }`}>
                        <span className="text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wider">{f.label}</span>
                        <FieldValue field={f} idx={`${si}-${fi}`} copied={copied} onCopy={handleCopy} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : fields ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {fields.map((f, i) => (
                <div key={i} className={`flex flex-col gap-1 ${
                  f.mono && String(f.value ?? "").length > 30 ? "sm:col-span-2" : ""
                }`}>
                  <span className="text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wider">{f.label}</span>
                  <FieldValue field={f} idx={String(i)} copied={copied} onCopy={handleCopy} />
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex items-center px-6 py-3 bg-muted/30 border-t border-border">
          {onDelete && (
            <button onClick={onDelete}
              className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-md text-red-600 hover:bg-red-50 transition-colors">
              <Trash2 className="w-3.5 h-3.5" /> {t.common.delete}
            </button>
          )}
          {!onDelete && deleteDisabledReason && (
            <button disabled title={deleteDisabledReason}
              className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-md text-muted-foreground/40 cursor-not-allowed">
              <Trash2 className="w-3.5 h-3.5" /> {t.common.delete}
            </button>
          )}
          {onShowJson && (
            <button onClick={onShowJson}
              className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-md text-muted-foreground hover:bg-muted transition-colors">
              <Code className="w-3.5 h-3.5" /> JSON
            </button>
          )}
          {onDuplicate && (
            <button onClick={onDuplicate}
              className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-md text-muted-foreground hover:bg-muted transition-colors">
              <Files className="w-3.5 h-3.5" /> {t.common.duplicate}
            </button>
          )}
          <div className="flex-1" />
          <div className="flex gap-2">
            <button onClick={onClose}
              className="text-[12px] px-4 py-1.5 rounded-md border border-border hover:bg-muted transition-colors text-muted-foreground font-medium">
              {t.common.close}
            </button>
            {onEdit && (
              <button onClick={onEdit}
                className="flex items-center gap-1.5 text-[12px] px-4 py-1.5 rounded-md bg-primary hover:bg-primary/90 text-primary-foreground font-medium transition-colors shadow-sm">
                <Pencil className="w-3.5 h-3.5" /> {t.common.edit}
              </button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Generic Confirm-Action Dialog ──────────────────────────── */
// Use for any "are you sure?" flow that isn't a delete. Optional input field
// (e.g., termination reason). Optional severity tone.
interface ConfirmActionDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: React.ReactNode;
  /** Identifier shown as monospaced subtitle (e.g., negotiation id) */
  subtitle?: string;
  /** Severity color tone */
  tone?: "danger" | "warn" | "info";
  /** Confirm button label (defaults to t.common.confirm) */
  confirmLabel?: string;
  /** Cancel button label (defaults to t.common.cancel) */
  cancelLabel?: string;
  /** When set, renders an input field; confirm is disabled until non-empty */
  input?: {
    placeholder: string;
    helper?: React.ReactNode;
    value: string;
    onChange: (v: string) => void;
    autoFocus?: boolean;
  };
  /** Submitting state — disables buttons */
  loading?: boolean;
  onConfirm: () => void;
}

const TONE_BTN: Record<NonNullable<ConfirmActionDialogProps["tone"]>, string> = {
  danger: "bg-rose-600 hover:bg-rose-700 text-white",
  warn:   "bg-amber-500 hover:bg-amber-600 text-white",
  info:   "bg-primary hover:bg-primary/90 text-primary-foreground",
};

const TONE_ICON: Record<NonNullable<ConfirmActionDialogProps["tone"]>, { color: string; bg: string }> = {
  danger: { color: "text-rose-600",  bg: "bg-rose-100" },
  warn:   { color: "text-amber-600", bg: "bg-amber-100" },
  info:   { color: "text-blue-600",  bg: "bg-blue-100" },
};

export function ConfirmActionDialog({
  open, onClose, title, description, subtitle, tone = "info",
  confirmLabel, cancelLabel, input, loading, onConfirm,
}: ConfirmActionDialogProps) {
  const { t } = useI18n();
  const { color, bg } = TONE_ICON[tone];
  const canConfirm = !loading && (!input || input.value.trim().length > 0);
  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && !loading && onClose()}>
      <AlertDialogContent className="max-w-sm">
        <AlertDialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className={`w-10 h-10 rounded-full ${bg} flex items-center justify-center flex-shrink-0`}>
              <AlertTriangle className={`w-5 h-5 ${color}`} />
            </div>
            <div className="flex-1 min-w-0">
              <AlertDialogTitle className="font-display text-[15px]">{title}</AlertDialogTitle>
              {description && (
                <AlertDialogDescription className="text-[12px] mt-0.5">
                  {description}
                </AlertDialogDescription>
              )}
            </div>
          </div>
        </AlertDialogHeader>
        {subtitle && (
          <MonoText className="text-[12px] font-normal text-foreground/60 break-all block mt-1">{subtitle}</MonoText>
        )}
        {input && (
          <div className="mt-3">
            <input
              type="text"
              autoFocus={input.autoFocus}
              value={input.value}
              onChange={(e) => input.onChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && canConfirm) onConfirm(); }}
              placeholder={input.placeholder}
              className="w-full px-3 py-1.5 text-[12px] border border-border rounded-md bg-muted focus:outline-none focus:ring-1 focus:ring-rose-400"
            />
            {input.helper && (
              <p className="text-[11px] text-muted-foreground mt-1">{input.helper}</p>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2 mt-3">
          <AlertDialogCancel disabled={loading} className="text-[12px] px-4">
            {cancelLabel ?? t.common.cancel}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={!canConfirm}
            className={`text-[12px] px-4 ${TONE_BTN[tone]} disabled:opacity-60 disabled:cursor-not-allowed`}
          >
            {loading && <Loader2 className="w-3 h-3 animate-spin mr-1.5" />}
            {confirmLabel ?? t.common.confirm}
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/* ─── JSON Viewer Dialog ─────────────────────────────────────── */
// Generic large viewer for serialized resource JSON. Includes copy + download.
interface JsonViewerDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Identifier shown as small subtitle (e.g., resource id) */
  subtitle?: string;
  /** JSON content (already stringified) */
  json: string;
  /** Filename for download (without extension); defaults to subtitle or "resource" */
  downloadName?: string;
}

export function JsonViewerDialog({ open, onClose, title, subtitle, json, downloadName }: JsonViewerDialogProps) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* noop */ }
  };
  const handleDownload = () => {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${downloadName ?? subtitle ?? "resource"}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl p-0 overflow-hidden flex flex-col max-h-[85vh]">
        <DialogHeader className="px-5 py-3 border-b border-border flex-row items-center gap-2 space-y-0">
          <Code className="w-4 h-4 text-muted-foreground" />
          <DialogTitle className="font-display text-[15px] text-foreground font-semibold">{title}</DialogTitle>
          {subtitle && <MonoText className="text-[12px] font-normal text-muted-foreground">{subtitle}</MonoText>}
        </DialogHeader>
        <div className="flex-1 overflow-auto p-4 min-h-0">
          <pre className="mono text-[12px] text-foreground/80 bg-muted/50 rounded-lg p-3 overflow-auto whitespace-pre-wrap leading-relaxed border border-border">
            {json}
          </pre>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-md border border-border hover:bg-muted text-muted-foreground"
          >
            {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? t.common.copied : t.common.copy}
          </button>
          <button
            onClick={handleDownload}
            className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-md bg-primary hover:bg-primary/90 text-primary-foreground font-medium"
          >
            <Download className="w-3.5 h-3.5" />
            {t.common.downloadJson ?? "Download"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Delete Confirmation Dialog ─────────────────────────────── */
interface DeleteDialogProps {
  open: boolean;
  onClose: () => void;
  itemName: string;
  onConfirm: () => Promise<void>;
  queryKeys: string[][];
}

export function DeleteConfirmDialog({ open, onClose, itemName, onConfirm, queryKeys }: DeleteDialogProps) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await onConfirm();
      queryKeys.forEach((key) => queryClient.invalidateQueries({ queryKey: key }));
      toast.success(t.common.deleted);
      onClose();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent className="max-w-sm">
        <AlertDialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-5 h-5 text-red-600" />
            </div>
            <div>
              <AlertDialogTitle className="font-display text-[15px]">{t.common.confirmDelete}</AlertDialogTitle>
              <AlertDialogDescription className="text-[12px] mt-0.5">
                {t.common.confirmDeleteDesc(itemName)}
              </AlertDialogDescription>
            </div>
          </div>
        </AlertDialogHeader>
        <div className="flex justify-end gap-2 mt-3">
          <AlertDialogCancel disabled={deleting} className="text-[12px] px-4">
            {t.common.cancel}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={deleting}
            className="bg-red-600 hover:bg-red-700 text-white text-[12px] px-4"
          >
            {deleting && <Loader2 className="w-3 h-3 animate-spin mr-1.5" />}
            {t.common.delete}
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
