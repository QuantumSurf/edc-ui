// KMX EDC — Reusable Detail + Delete Dialog Components
// Used by PageAssets, PagePolicy, PageOffering

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { useI18n } from "@/i18n";
import { Loader2, Pencil, Trash2, Copy, CheckCircle2, AlertTriangle, Files, Code, Download, X, FileJson, ChevronsRight, Search, ListTree } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { MonoText, JsonTreeView } from "@/components/ui-kmx";

/* ─── Detail Dialog ──────────────────────────────────────────── */
interface DetailField {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  copyable?: boolean;
  /** Render value as syntax-highlighted JSON in a pre block */
  pre?: boolean;
  /** Render the given object with the collapsible JsonTreeView (existing JSON viewer style) */
  json?: unknown;
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
  /** Optional icon shown to the left of the title (DetailPanel only). */
  icon?: React.ReactNode;
  subtitle?: string;
  /** Render subtitle in monospace font. Default true (for IDs/hashes); set false for descriptive Korean text. */
  subtitleMono?: boolean;
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

function FieldValue({ field, idx, copied, onCopy, inCard }: { field: DetailField; idx: string; copied: string | null; onCopy: (text: string, key: string) => void; inCard?: boolean }) {
  const { t } = useI18n();
  // Collapsible JSON tree (existing JSON viewer style)
  if (field.json !== undefined) {
    return <JsonTreeView data={field.json} className="max-h-[280px]" />;
  }

  // Pre-formatted JSON block
  if (field.pre && field.value) {
    return (
      <div className="relative group/pre">
        <pre className="mono text-[12px] bg-slate-900 text-slate-300 rounded-lg p-3 overflow-auto max-h-[240px] whitespace-pre-wrap leading-relaxed">
          {field.value}
        </pre>
        {field.copyable && (
          <button
            onClick={() => onCopy(String(field.value), idx)}
            aria-label={t.common.copy}
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
        <span className={`text-xs text-foreground leading-relaxed ${field.mono ? "break-all" : ""}`}>
          {field.value || <span className="text-muted-foreground/60 italic">N/A</span>}
        </span>
      )}
      {field.copyable && field.value && (
        <button
          onClick={() => onCopy(String(field.value), idx)}
          aria-label={t.common.copy}
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

export function DetailDialog({ open, onClose, title, subtitle, subtitleMono = true, fields, sections, onEdit, onDelete, onDuplicate, onShowJson, deleteDisabledReason }: DetailDialogProps) {
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
          <DialogHeader className="border-b-0 pb-0">
            <DialogTitle className="font-display text-[15px] text-foreground font-semibold">{title}</DialogTitle>
            {subtitle && (
              <div className="flex items-center gap-2 mt-1.5">
                <span className={`${subtitleMono ? "mono" : ""} text-[12px] font-normal text-foreground bg-muted/60 border border-border/40 px-2 py-0.5 rounded-md`}>{subtitle}</span>
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
                        <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{f.label}</span>
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
                  <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{f.label}</span>
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

/* ─── Detail Panel (slide-in) ────────────────────────────────── */
// Slide-in-from-right panel variant of DetailDialog — same props/API.
// Referenced from fl-aggregator's task detail. Used by Assets/Policy/Offering.
export function DetailPanel({ open, onClose, title, icon, subtitle, subtitleMono = true, fields, sections, onEdit, onDelete, onDuplicate, onShowJson, deleteDisabledReason }: DetailDialogProps) {
  const { t } = useI18n();
  const [copied, setCopied] = useState<string | null>(null);
  const [entered, setEntered] = useState(false);

  // Trigger the slide-in transition on mount.
  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Close on ESC.
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [onClose]);

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  };

  if (!open) return null;
  const renderSections = sections && sections.length > 0;

  return (
    <>
      <div
        className={cn("fixed inset-0 z-40 bg-black/20 transition-opacity duration-200", entered ? "opacity-100" : "opacity-0")}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className={cn(
          "fixed right-0 top-0 z-50 h-full w-full max-w-md bg-card border-l border-border shadow-2xl flex flex-col transition-transform duration-200 ease-out",
          entered ? "translate-x-0" : "translate-x-full",
        )}
      >
        {/* Header */}
        <div className="flex items-center px-6 pt-5 pb-4 pr-10 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            {icon && <span className="flex items-center flex-shrink-0">{icon}</span>}
            <div className="min-w-0">
              <p className="text-[15px] font-semibold text-foreground truncate">{title}</p>
              {subtitle && (
                <p className={cn("text-[11px] text-muted-foreground truncate mt-0.5", subtitleMono && "mono")}>{subtitle}</p>
              )}
            </div>
          </div>
        </div>
        {/* 닫기 — fl-aggregator 우상단 절대 위치 표준 */}
        <button
          onClick={onClose}
          aria-label={t.common.close}
          className="absolute top-4 right-4 z-10 rounded-xs opacity-70 transition-opacity hover:opacity-100 ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          <X className="size-4" />
        </button>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {renderSections ? (
            <div className="space-y-5">
              {sections.map((section, si) => (
                <div key={si}>
                  <h4 className="mb-2.5 flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                    <ChevronsRight className="w-3.5 h-3.5 text-primary" />{section.title}
                  </h4>
                  <div className="space-y-2.5">
                    {section.fields.map((f, fi) => {
                      const isBlock = f.pre || f.json !== undefined;
                      // 빈 값 일반 필드는 렌더 생략 (배지/블록 필드는 유지)
                      if (!isBlock && !f.badge && (f.value === null || f.value === undefined || f.value === "")) return null;
                      return isBlock ? (
                        <div key={fi} className="flex flex-col gap-1">
                          <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{f.label}</span>
                          <FieldValue field={f} idx={`${si}-${fi}`} copied={copied} onCopy={handleCopy} />
                        </div>
                      ) : (
                        <div key={fi} className="border-b border-border/60 pb-2.5">
                          <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-1">{f.label}</p>
                          <FieldValue field={f} idx={`${si}-${fi}`} copied={copied} onCopy={handleCopy} inCard />
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : fields ? (
            <div className="space-y-3">
              {fields.map((f, i) => (
                <div key={i} className="flex flex-col gap-1">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{f.label}</span>
                  <FieldValue field={f} idx={String(i)} copied={copied} onCopy={handleCopy} />
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-1 px-6 py-4 border-t border-border bg-muted/30 flex-shrink-0">
          {onDelete && (
            <button onClick={onDelete}
              className="flex items-center gap-1.5 text-[12px] px-2.5 py-1.5 rounded-md text-red-600 hover:bg-red-50 transition-colors">
              <Trash2 className="w-3.5 h-3.5" /> {t.common.delete}
            </button>
          )}
          {!onDelete && deleteDisabledReason && (
            <button disabled title={deleteDisabledReason}
              className="flex items-center gap-1.5 text-[12px] px-2.5 py-1.5 rounded-md text-muted-foreground/40 cursor-not-allowed">
              <Trash2 className="w-3.5 h-3.5" /> {t.common.delete}
            </button>
          )}
          {onShowJson && (
            <button onClick={onShowJson}
              className="flex items-center gap-1.5 text-[12px] px-2.5 py-1.5 rounded-md text-muted-foreground hover:bg-muted transition-colors">
              <Code className="w-3.5 h-3.5" /> JSON
            </button>
          )}
          {onDuplicate && (
            <button onClick={onDuplicate}
              className="flex items-center gap-1.5 text-[12px] px-2.5 py-1.5 rounded-md text-muted-foreground hover:bg-muted transition-colors">
              <Files className="w-3.5 h-3.5" /> {t.common.duplicate}
            </button>
          )}
          <div className="flex-1" />
          <button onClick={onClose}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium border border-border text-foreground rounded-lg hover:bg-muted transition-colors">
            <X className="w-3.5 h-3.5" /> {t.common.close}
          </button>
          {onEdit && (
            <button onClick={onEdit}
              className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-md bg-primary hover:bg-primary/90 text-primary-foreground font-medium transition-colors shadow-sm">
              <Pencil className="w-3.5 h-3.5" /> {t.common.edit}
            </button>
          )}
        </div>
      </aside>
    </>
  );
}

/* ─── Slide-in Panel shell ───────────────────────────────────── */
// Generic right-side slide-in container — supply header/content/footer as
// children. Used by detail views with custom (non field-list) content.
export function SlidePanel({ open, onClose, children, className, closeDisabled }: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  /** 저장 등 busy 중 닫기(X·ESC·백드롭) 차단 */
  closeDisabled?: boolean;
}) {
  const { t } = useI18n();
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape" && !closeDisabled) onClose(); };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [onClose, closeDisabled]);

  if (!open) return null;

  return (
    <>
      <div
        className={cn("fixed inset-0 z-40 bg-black/20 transition-opacity duration-200", entered ? "opacity-100" : "opacity-0")}
        onClick={() => { if (!closeDisabled) onClose(); }}
        aria-hidden="true"
      />
      <aside
        className={cn(
          "fixed right-0 top-0 z-50 h-full w-full max-w-md bg-card border-l border-border shadow-2xl flex flex-col transition-transform duration-200 ease-out",
          entered ? "translate-x-0" : "translate-x-full",
          className,
        )}
      >
        {children}
        {/* 닫기 — fl-aggregator SheetContent와 동일한 우상단 절대 위치 스타일 */}
        <button
          onClick={onClose}
          disabled={closeDisabled}
          aria-label={t.common.close}
          className="absolute top-4 right-4 z-10 rounded-xs opacity-70 transition-opacity hover:opacity-100 ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none disabled:opacity-40"
        >
          <X className="size-4" />
        </button>
      </aside>
    </>
  );
}

/* ─── Detail Sheet primitives (계약 협상 상세 스타일) ─────────────── */
// 슬라이드 상세 시트에서 쓰는 슬레이트 카드 그리드 + 섹션 헤더.
// PageNegotiation 상세 시트와 동일 스타일을 다른 상세화면에서 재사용한다.
export function InfoCard({ label, value, span, mono, copyable }: {
  label: string;
  value: React.ReactNode;
  span?: boolean;
  mono?: boolean;
  copyable?: string;
}) {
  const { t } = useI18n();
  // 빈 값 필드는 렌더링하지 않는다 (덩그러니 "—" 표시 방지)
  if (value === null || value === undefined || value === "" || value === "—") return null;
  return (
    <div className={cn("border-b border-border/60 pb-2.5", span && "md:col-span-2")}>
      <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="flex items-start gap-1.5 mt-1">
        <div className="text-xs text-foreground break-all flex-1 leading-relaxed">{value}</div>
        {copyable && (
          <button
            onClick={() => { navigator.clipboard.writeText(copyable); toast.success(t.common.copied); }}
            className="flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors mt-0.5"
            aria-label={t.common.copy}
          >
            <Copy size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

export function DetailSection({ title, tone = "sky", action, children }: {
  title: string;
  tone?: "sky" | "rose";
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className={cn(
          "text-[11px] font-bold uppercase tracking-wide flex items-center gap-1",
          tone === "rose" ? "text-rose-600" : "text-muted-foreground",
        )}>
          <ChevronsRight className={cn("w-3.5 h-3.5", tone === "rose" ? "text-rose-500" : "text-primary")} />
          {title}
        </p>
        {action}
      </div>
      {children}
    </div>
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
  /** 비동기 로딩 중이면 스피너 표시 */
  loading?: boolean;
}

export function JsonViewerDialog({ open, onClose, title, subtitle, json, downloadName, loading }: JsonViewerDialogProps) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [mode, setMode] = useState<"tree" | "raw">("tree");
  const [search, setSearch] = useState("");
  const [baseCollapsed, setBaseCollapsed] = useState(false);
  const [resetToken, setResetToken] = useState(0);

  let parsed: unknown;
  let parsedOk = false;
  try { parsed = JSON.parse(json); parsedOk = true; } catch { parsedOk = false; }

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
  const expandAll = () => { setBaseCollapsed(false); setResetToken((n) => n + 1); };
  const collapseAll = () => { setBaseCollapsed(true); setResetToken((n) => n + 1); };

  const segBtn = (active: boolean) =>
    cn("inline-flex items-center gap-1 text-[11px] px-2 py-1 transition-colors",
      active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted");

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <FileJson className="w-4 h-4 text-blue-500" />
            {title}
          </DialogTitle>
          {subtitle && (
            <p className="text-sm text-muted-foreground break-all mt-1">{subtitle}</p>
          )}
        </DialogHeader>

        {/* Toolbar: 트리/원문 토글 · 모두 펼치기/접기 · 검색 */}
        {!loading && parsedOk && (
          <div className="flex items-center gap-2 flex-wrap flex-shrink-0">
            <div className="flex rounded-md border border-border overflow-hidden flex-shrink-0">
              <button onClick={() => setMode("tree")} className={segBtn(mode === "tree")}>
                <ListTree className="w-3 h-3" /> {t.common.viewTree}
              </button>
              <button onClick={() => setMode("raw")} className={cn(segBtn(mode === "raw"), "border-l border-border")}>
                <Code className="w-3 h-3" /> {t.common.viewRaw}
              </button>
            </div>
            {mode === "tree" && (
              <>
                <button onClick={expandAll} className="text-[11px] px-2 py-1 rounded border border-border text-muted-foreground hover:bg-muted hover:text-foreground transition-colors flex-shrink-0">
                  {t.common.expandAll}
                </button>
                <button onClick={collapseAll} className="text-[11px] px-2 py-1 rounded border border-border text-muted-foreground hover:bg-muted hover:text-foreground transition-colors flex-shrink-0">
                  {t.common.collapseAll}
                </button>
                <div className="relative flex-1 min-w-[140px]">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t.common.jsonSearch}
                    className="w-full pl-7 pr-2 py-1 text-[11px] border border-border rounded-md bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </>
            )}
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-hidden flex flex-col mt-1">
          {loading ? (
            <div className="flex items-center justify-center py-10 gap-2 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-[13px]">{t.common.loading}</span>
            </div>
          ) : mode === "raw" || !parsedOk ? (
            <pre className="flex-1 min-h-0 overflow-auto bg-slate-900 text-slate-300 rounded-lg p-3 text-[12px] mono leading-relaxed whitespace-pre-wrap">
              {json}
            </pre>
          ) : (
            <JsonTreeView data={parsed} className="flex-1 min-h-0" search={search} baseCollapsed={baseCollapsed} resetToken={resetToken} />
          )}
        </div>

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-border flex-shrink-0">
          <button
            onClick={handleCopy}
            disabled={loading || !json}
            className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-border text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
          >
            {copied ? <CheckCircle2 className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
            {copied ? t.common.copied : t.common.copy}
          </button>
          <button
            onClick={handleDownload}
            disabled={loading || !json}
            className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-border text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
          >
            <Download className="w-3 h-3" />
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
  /** 식별자(예: URN/ID)를 description 아래 mono 줄로 표시 */
  subtitle?: string;
  /** 성공 토스트 문구(미지정 시 t.common.deleted) */
  successMessage?: string;
}

export function DeleteConfirmDialog({ open, onClose, itemName, onConfirm, queryKeys, subtitle, successMessage }: DeleteDialogProps) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await onConfirm();
      queryKeys.forEach((key) => queryClient.invalidateQueries({ queryKey: key }));
      toast.success(successMessage ?? t.common.deleted);
      onClose();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && !deleting && onClose()}>
      <AlertDialogContent className="max-w-sm">
        <AlertDialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-full bg-rose-100 flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-5 h-5 text-rose-600" />
            </div>
            <div className="flex-1 min-w-0">
              <AlertDialogTitle className="font-display text-[15px]">{t.common.confirmDelete}</AlertDialogTitle>
              <AlertDialogDescription className="text-[12px] mt-0.5">
                {t.common.confirmDeleteDesc(itemName)}
              </AlertDialogDescription>
            </div>
          </div>
        </AlertDialogHeader>
        {subtitle && (
          <MonoText className="text-[12px] font-normal text-foreground/60 break-all block mt-1">{subtitle}</MonoText>
        )}
        <div className="flex justify-end gap-2 mt-3">
          <AlertDialogCancel disabled={deleting} className="text-[12px] px-4 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary">
            {t.common.cancel}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={deleting}
            className="bg-rose-600 hover:bg-rose-700 text-white text-[12px] px-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
          >
            {deleting && <Loader2 className="w-3 h-3 animate-spin mr-1.5" />}
            {t.common.delete}
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
