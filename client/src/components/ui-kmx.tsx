// Connector Hub — Shared UI Primitives
// Design: Admin Console style | Dark navy sidebar + white cards + light gray bg

import { cn } from "@/lib/utils";
import { X, AlertTriangle, Info, AlertCircle, CheckCircle2, TrendingUp, Check, ChevronRight, ChevronDown, List, RefreshCw, ArrowUpRight, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import React from "react";
import { useI18n } from "@/i18n";

/* ─── Badge ─────────────────────────────────────────────────── */
// fl-aggregator 톤의 상태 배지: 흰 배경 + 색상 텍스트/테두리 (색상 점 없음 — 사용자 결정).
// 진행 중 상태는 pulse로 배지 전체가 깜빡인다.
type BadgeVariant = "green" | "blue" | "teal" | "amber" | "red" | "purple" | "gray" | "outline" | "sky";

const BADGE_STYLES: Record<BadgeVariant, { text: string; border: string }> = {
  sky:     { text: "text-blue-700",    border: "border-blue-200"    },
  green:   { text: "text-emerald-700", border: "border-emerald-200" },
  blue:    { text: "text-blue-700",    border: "border-blue-200"    },
  teal:    { text: "text-teal-700",    border: "border-teal-200"    },
  amber:   { text: "text-amber-700",   border: "border-amber-200"   },
  red:     { text: "text-red-700",     border: "border-red-200"     },
  purple:  { text: "text-purple-700",  border: "border-purple-200"  },
  gray:    { text: "text-slate-600",   border: "border-slate-200"   },
  outline: { text: "text-foreground",  border: "border-border"      },
};

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
  pulse?: boolean;
  /** @deprecated 점 표시는 제거됨 — 하위 호환용으로만 유지 */
  dot?: boolean;
}

export function Badge({ children, variant = "gray", className, pulse }: BadgeProps) {
  const { text, border } = BADGE_STYLES[variant];
  return (
    <span className={cn(
      "inline-flex items-center rounded border font-normal whitespace-nowrap bg-white text-[11px] px-2 py-0.5 gap-1.5",
      text,
      border,
      pulse && "status-pulse",
      className
    )}>
      {children}
    </span>
  );
}

/* ─── State Badge ────────────────────────────────────────────── */
const STATE_VARIANT: Record<string, BadgeVariant> = {
  FINALIZED:  "blue",
  REQUESTING: "sky",
  AGREED:     "teal",
  VERIFIED:   "teal",
  OFFERED:    "teal",
  ACCEPTED:   "teal",
  TERMINATED: "red",
  STARTED:    "sky",
  COMPLETED:  "green",
  SUSPENDED:  "amber",
  INITIAL:    "gray",
};

export function StateBadge({ name }: { name: string }) {
  const variant = STATE_VARIANT[name] ?? "gray";
  const isPulse = name === "REQUESTING" || name === "STARTED";
  return <Badge variant={variant} pulse={isPulse}>{name}</Badge>;
}

/* ─── Status Pill ────────────────────────────────────────────── */
// Badge에 위임 — 점/색상은 variant 매핑으로 일원화 (fl-aggregator 스타일).
export function StatusPill({ status = "down" }: { status?: "up" | "warn" | "down" }) {
  const map: Record<string, { variant: BadgeVariant; label: string; pulse?: boolean }> = {
    up:   { variant: "green", label: "UP" },
    warn: { variant: "amber", label: "WARN", pulse: true },
    down: { variant: "red",   label: "DOWN" },
  };
  const { variant, label, pulse } = map[status] ?? map.down;
  return <Badge variant={variant} pulse={pulse}>{label}</Badge>;
}

/* ─── KPI Card — large number style (matching image) ─────────── */
interface KpiCardProps {
  label?: string;
  /** Optional heading shown at the top of the card, next to the icon. */
  title?: string;
  value: string | number;
  sub?: string;
  colorClass?: string;
  valueColor?: string;
  icon?: React.ReactNode;
  iconBg?: string;
  trend?: "up" | "down" | "neutral";
  iconColor?: string;
  loading?: boolean;
  /** 클릭 가능 KPI(딥링크) — 지정 시 카드가 버튼 시맨틱을 가짐 */
  onClick?: () => void;
  ariaLabel?: string;
}

export function KpiCard({ label, title, value, sub, colorClass, valueColor, icon, iconBg, trend, iconColor, loading, onClick, ariaLabel }: KpiCardProps) {
  // fl-aggregator KpiCard 구조: p-4 / gap-2.5 / 아이콘 박스 옆 라벨 / text-3xl tabular-nums.
  // onClick(딥링크) 시 우측 상단 ArrowUpRight 인디케이터 — trend가 있으면 trend 표시 우선.
  return (
    <div
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={onClick ? ariaLabel : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
      className={cn(
        "bg-card rounded-xl border border-border shadow-sm p-4 flex flex-col gap-2.5",
        onClick && "group cursor-pointer transition-all hover:shadow-md hover:border-primary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-400/70",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 min-w-0">
          {icon && (
            <span className={cn("w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0", iconBg ?? iconColor ?? "bg-blue-50")}>
              {icon}
            </span>
          )}
          {(title || label) && (
            <span className="text-[12px] text-muted-foreground font-medium truncate">{title ?? label}</span>
          )}
        </span>
        {trend ? (
          <TrendingUp className={cn(
            "w-4 h-4 flex-shrink-0",
            trend === "up" ? "text-emerald-500" : trend === "down" ? "text-rose-500" : "text-muted-foreground"
          )} />
        ) : onClick ? (
          <ArrowUpRight className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground/30 group-hover:text-primary transition-colors" />
        ) : null}
      </div>
      {loading ? (
        <div className="h-9 w-16 bg-muted animate-pulse rounded" />
      ) : (
        <div className={cn("text-3xl font-bold tabular-nums leading-none", valueColor ?? colorClass ?? "text-foreground")}>
          {value}
        </div>
      )}
      {title && label && <div className="text-[13px] font-medium text-foreground/80">{label}</div>}
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

/* ─── Service Health Card (matching image top row) ───────────── */
interface ServiceCardProps {
  name: string;
  desc: string;
  status: "healthy" | "degraded" | "unknown";
  icon?: React.ReactNode;
}

export function ServiceCard({ name, desc, status, icon }: ServiceCardProps) {
  const statusMap = {
    healthy:  { dot: "bg-emerald-500", label: "Healthy",  cls: "text-emerald-600" },
    degraded: { dot: "bg-rose-500",    label: "Degraded", cls: "text-rose-600"    },
    unknown:  { dot: "bg-amber-500",   label: "Unknown",  cls: "text-amber-600"   },
  };
  const { dot, label, cls } = statusMap[status];
  return (
    <div className="bg-card rounded-xl p-4 shadow-sm border border-border flex items-start gap-3 hover:shadow-md transition-shadow">
      {icon && (
        <div className={cn(
          "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5",
          status === "healthy"  ? "bg-emerald-50 text-emerald-600" :
          status === "degraded" ? "bg-rose-50 text-rose-600" :
                                  "bg-amber-50 text-amber-600"
        )}>
          {icon}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="font-display text-[14px] font-semibold text-foreground">{name}</div>
        <div className="text-[12px] text-muted-foreground mt-0.5">{desc}</div>
        <div className={cn("flex items-center gap-1.5 mt-1.5 text-[12px] font-medium", cls)}>
          <span className={cn("w-1.5 h-1.5 rounded-full", dot)} />
          {label}
        </div>
      </div>
    </div>
  );
}

/* ─── Alert Banner ───────────────────────────────────────────── */
type AlertVariant = "warn" | "info" | "danger" | "success";

const ALERT_STYLES: Record<AlertVariant, { bg: string; border: string; text: string; Icon: React.ElementType }> = {
  warn:    { bg: "bg-amber-50",   border: "border-amber-200",   text: "text-amber-800",   Icon: AlertTriangle  },
  info:    { bg: "bg-sky-50",     border: "border-sky-200",     text: "text-sky-800",     Icon: Info           },
  danger:  { bg: "bg-rose-50",    border: "border-rose-200",    text: "text-rose-800",    Icon: AlertCircle    },
  success: { bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-800", Icon: CheckCircle2   },
};

interface AlertBannerProps {
  children: React.ReactNode;
  variant?: AlertVariant;
  onClose?: () => void;
}

export function AlertBanner({ children, variant = "warn", onClose }: AlertBannerProps) {
  const { bg, border, text, Icon } = ALERT_STYLES[variant];
  return (
    <div className={cn("flex items-start gap-2.5 px-4 py-3 rounded-xl border text-[12px] shadow-sm", bg, border, text)}>
      <Icon className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
      <span className="flex-1">{children}</span>
      {onClose && (
        <button onClick={onClose} className="opacity-50 hover:opacity-100 transition-opacity">
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

/* ─── Section Header ─────────────────────────────────────────── */
interface SectionHdrProps {
  children: React.ReactNode;
  action?: React.ReactNode;
  breadcrumb?: string;
  icon?: React.ReactNode;
}

export function SectionHdr({ children, action, breadcrumb, icon }: SectionHdrProps) {
  // fl-aggregator 페이지 헤더: 제목+서브타이틀 좌측, 액션 우측, 하단 보더.
  // 아이콘은 w-5 h-5 text-primary로 정규화(호출부의 다양한 크기·색 통일).
  return (
    <div className="flex items-start justify-between gap-4 flex-wrap pb-1.5 border-b border-border">
      <div>
        <h1 className="text-2xl font-bold text-foreground tracking-tight flex items-center gap-2 [&>svg]:w-5 [&>svg]:h-5 [&>svg]:text-primary">
          {icon}
          {children}
        </h1>
        {breadcrumb && (
          <p className="text-sm text-muted-foreground mt-1">{breadcrumb}</p>
        )}
      </div>
      {action}
    </div>
  );
}

/* ─── Card ───────────────────────────────────────────────────── */
interface CardProps {
  title?: React.ReactNode;
  children: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  noPad?: boolean;
}

export function Card({ title, children, actions, className, noPad }: CardProps) {
  return (
    <div className={cn("bg-card rounded-xl overflow-hidden shadow-sm border border-border", className)}>
      {title && (
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border">
          <span className="font-display text-[15px] font-bold text-foreground">{title}</span>
          {actions && <div className="flex items-center gap-1.5">{actions}</div>}
        </div>
      )}
      <div className={noPad ? "" : "p-4"}>{children}</div>
    </div>
  );
}

/* ─── Stepper ────────────────────────────────────────────────── */
interface StepperProps {
  steps: string[];
  current: number;
  icons?: React.ReactNode[];
}

export function Stepper({ steps, current, icons }: StepperProps) {
  return (
    <div className="flex mb-5 rounded-lg overflow-hidden border border-gray-200">
      {steps.map((s, i) => {
        const done = i < current;
        const curr = i === current;
        return (
          <div
            key={i}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-2.5 px-3 text-[11px] font-medium border-r border-gray-200 last:border-r-0 transition-colors",
              done && "bg-blue-50 text-blue-700",
              curr && "bg-blue-600 text-white",
              !done && !curr && "bg-gray-50 text-muted-foreground",
            )}
          >
            {/* Step indicator: checkmark if done */}
            {done && (
              <span className="w-4.5 h-4.5 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0">
                <Check className="w-3 h-3 text-white" />
              </span>
            )}
            {/* Step icon (optional, shown when not done) */}
            {!done && icons?.[i] && (
              <span className="flex-shrink-0 [&>svg]:w-3.5 [&>svg]:h-3.5">{icons[i]}</span>
            )}
            {s}
          </div>
        );
      })}
    </div>
  );
}

/* ─── Mono Text ──────────────────────────────────────────────── */
export function MonoText({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("mono text-[12px] text-foreground", className)}>
      {children}
    </span>
  );
}

/* ─── Inline Code ────────────────────────────────────────────── */
export function InlineCode({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <code className={cn("mono text-[11px] bg-gray-100 px-1.5 py-0.5 rounded text-foreground/80 border border-gray-200", className)}>
      {children}
    </code>
  );
}

/* ─── Progress Bar ───────────────────────────────────────────── */
interface ProgressBarProps {
  value: number;
  colorClass?: string;
  className?: string;
}

export function ProgressBar({ value, colorClass, className }: ProgressBarProps) {
  return (
    <div className={cn("h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden", className)}>
      <div
        className={cn("h-full rounded-full transition-all", colorClass ?? "bg-blue-500")}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

/* ─── Empty State ────────────────────────────────────────────── */
export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
      <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mb-3">
        <span className="text-xl opacity-40">∅</span>
      </div>
      <p className="text-xs">{message}</p>
    </div>
  );
}

/* ─── Form Field ─────────────────────────────────────────────── */
interface FormFieldProps {
  label: string;
  children: React.ReactNode;
  required?: boolean;
  hint?: string;
}

export function FormField({ label, children, required, hint }: FormFieldProps) {
  // 바깥을 <label>로 감싸 컨트롤과 암시적 연결(WCAG 1.3.1). 내부 라벨 텍스트는 span(중첩 label 회피).
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] font-medium text-foreground">
        {label}{required && <span className="text-rose-500 ml-0.5">*</span>}
      </span>
      {children}
      {hint && <span className="block text-[11px] text-muted-foreground leading-snug">{hint}</span>}
    </label>
  );
}

/* ─── Editable field base class ──────────────────────────────── */
// Canonical styling for all editable text controls (input / textarea / select)
// so font, color, size, and focus behavior stay consistent across screens.
// Append " mono" for code-like values and " flex-1" etc. as needed.
export const inputBase =
  "w-full text-[12px] px-2.5 py-1.5 border border-border rounded-md bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60 disabled:cursor-not-allowed transition-colors";

/* ─── Env Badge ──────────────────────────────────────────────── */
export function EnvBadge({ env }: { env: string }) {
  const map: Record<string, BadgeVariant> = { PROD: "blue", STG: "amber", DEV: "sky" };
  return <Badge variant={map[env] ?? "gray"}>{env}</Badge>;
}

/* ─── Data Source Badge — LIVE / DEMO / MIXED ─────────────────── */
// Visibility helper to clarify whether a page section reflects real backend
// data or hardcoded demo content. Use on SectionHdr action or Card title.
type DataSourceMode = "live" | "demo" | "mixed";

export function DataSourceBadge({ mode }: { mode: DataSourceMode }) {
  const map: Record<DataSourceMode, { variant: BadgeVariant; label: string; pulse?: boolean }> = {
    live:  { variant: "green", label: "LIVE", pulse: true },
    demo:  { variant: "gray",  label: "DEMO" },
    mixed: { variant: "amber", label: "MIXED" },
  };
  const { variant, label, pulse } = map[mode];
  return <Badge variant={variant} pulse={pulse}>{label}</Badge>;
}

/* ─── Card Title — icon + text helper ─────────────────────────── */
// Standardizes "icon + label" titles used by most Cards across pages.
// Optional trailing badge slot for e.g. <DataSourceBadge>.
export function CardTitle({
  icon, children, badge,
}: { icon?: React.ReactNode; children: React.ReactNode; badge?: React.ReactNode }) {
  return (
    <span className="flex items-center gap-2">
      {icon}
      <span>{children}</span>
      {badge}
    </span>
  );
}

/* ─── Action Buttons — page header / view-all patterns ────────── */
// Filled blue button for primary actions (Add, Create, Submit).
// Use in SectionHdr.action or Card.actions.
interface PrimaryActionButtonProps {
  onClick?: () => void;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  type?: "button" | "submit";
  disabled?: boolean;
}
export function PrimaryActionButton({ onClick, icon, children, className, type = "button", disabled }: PrimaryActionButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 h-8 px-3 text-sm rounded-md bg-primary hover:bg-primary/90 text-primary-foreground font-medium transition-colors shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap",
        className,
      )}
    >
      {icon}
      {children}
    </button>
  );
}

// Subtle text link with chevron — for "View all", "See more", etc.
interface ViewAllLinkProps {
  onClick?: () => void;
  children: React.ReactNode;
  className?: string;
}
export function ViewAllLink({ onClick, children, className }: ViewAllLinkProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-0.5 text-xs text-primary hover:underline transition-colors rounded focus:outline-none focus-visible:ring-1 focus-visible:ring-primary",
        className,
      )}
    >
      {children}
      <ChevronRight className="w-3 h-3" />
    </button>
  );
}

// Quiet text button (back, breadcrumbs, dismiss). Muted by default.
interface QuietButtonProps {
  onClick?: () => void;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}
export function QuietButton({ onClick, icon, children, className }: QuietButtonProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors",
        className,
      )}
    >
      {icon}
      {children}
    </button>
  );
}

/* ─── Sortable Table Header (fl-aggregator 이식) ──────────────── */
// <th aria-sort> + 정렬 인디케이터(ArrowUpDown/Up/Down). useSort와 세트로 사용.
// 헤더 셀 패딩은 내부 버튼이 가지므로 th는 p-0 — 기존 px-4 py-3 th와 시각 동일.
export type SortOrder = "asc" | "desc" | null;

export function SortHeader({
  label, sortKey, currentKey, currentOrder, onClick, align = "left",
}: {
  label: string; sortKey: string;
  currentKey: string | null; currentOrder: SortOrder;
  onClick: (key: string) => void;
  align?: "left" | "right" | "center";
}) {
  const isSorted = currentKey === sortKey;
  const Icon = !isSorted ? ArrowUpDown : currentOrder === "asc" ? ArrowUp : ArrowDown;
  const ariaSort: React.AriaAttributes["aria-sort"] =
    isSorted ? (currentOrder === "asc" ? "ascending" : "descending") : "none";
  return (
    <th
      aria-sort={ariaSort}
      className={cn(
        "!text-[12px] whitespace-nowrap font-bold text-foreground p-0",
        align === "right" && "text-right",
        align === "center" && "text-center",
        align === "left" && "text-left",
      )}
    >
      <button
        type="button"
        onClick={() => onClick(sortKey)}
        className={cn(
          "w-full px-4 py-3 inline-flex items-center gap-1 cursor-pointer select-none hover:bg-muted/70 transition-colors",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-400/70",
          align === "right" && "justify-end",
          align === "center" && "justify-center",
        )}
      >
        {label}
        <Icon className={cn("w-3 h-3 flex-shrink-0", isSorted ? "text-primary" : "text-muted-foreground/40")} />
      </button>
    </th>
  );
}

export function useSort<T>(rows: T[], accessors: Record<string, (row: T) => string | number | null | undefined>) {
  const [sortKey, setSortKey] = React.useState<string | null>(null);
  const [sortOrder, setSortOrder] = React.useState<SortOrder>(null);
  const handleSort = (key: string) => {
    if (sortKey !== key) { setSortKey(key); setSortOrder("asc"); }
    else if (sortOrder === "asc") setSortOrder("desc");
    else { setSortKey(null); setSortOrder(null); }
  };
  const sorted = (!sortKey || !sortOrder) ? rows : [...rows].sort((a, b) => {
    const av = accessors[sortKey]?.(a);
    const bv = accessors[sortKey]?.(b);
    const dir = sortOrder === "asc" ? 1 : -1;
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
    return String(av).localeCompare(String(bv)) * dir;
  });
  return { sorted, sortKey, sortOrder, handleSort };
}

/* ─── List View (fl-aggregator style) ─────────────────────────── */
// Grid-based list shell matching the fl-aggregator look: bold dark headers
// (no uppercase), card title bar with a List icon, left-accent rows on hover.

// Outer card with a title bar. Place ListHeaderRow + ListRow(s) as children.
interface ListCardProps {
  title: React.ReactNode;
  icon?: React.ReactNode;
  iconColor?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}
export function ListCard({ title, icon, iconColor, actions, children, className }: ListCardProps) {
  return (
    <div className={cn("rounded-xl border border-border bg-card overflow-hidden shadow-sm", className)}>
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border">
        <span className="font-display text-[15px] font-bold text-foreground flex items-center gap-2 truncate">
          {icon ?? <List className={cn("w-4 h-4", iconColor ?? "text-primary")} />}
          {title}
        </span>
        {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

// Header row. `cols` must be a literal Tailwind grid-cols-[...] class so the
// JIT compiler can see it; pass the SAME class to every ListRow below it.
export function ListHeaderRow({ cols, className, children }: {
  cols: string; className?: string; children: React.ReactNode;
}) {
  return (
    <div className={cn("grid gap-3 px-4 py-3 border-b border-border bg-muted/50", cols, className)}>
      {children}
    </div>
  );
}

// Header cell label — bold, dark, not uppercase (fl-aggregator style).
export function ListColLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("text-[12px] font-bold text-foreground", className)}>{children}</span>;
}

// Data row. Pass the same `cols` class used by ListHeaderRow.
export function ListRow({ cols, selected, onClick, className, children }: {
  cols: string;
  selected?: boolean;
  onClick?: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
      className={cn(
        "grid gap-3 px-4 py-3 border-b border-border/60 last:border-0 transition-colors group border-l-2 items-center",
        cols,
        onClick && "cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary",
        selected
          ? "bg-primary/5 hover:bg-primary/10 border-l-primary"
          : "hover:bg-muted/30 border-l-transparent",
        className,
      )}
    >
      {children}
    </div>
  );
}

// Empty state — centered icon + message, fl-aggregator spacing.
export function ListEmpty({ icon, message }: { icon?: React.ReactNode; message: React.ReactNode }) {
  return (
    <div className="py-16 text-center">
      {icon && (
        <div className="mx-auto mb-2 flex items-center justify-center opacity-30 text-muted-foreground [&>svg]:w-8 [&>svg]:h-8">
          {icon}
        </div>
      )}
      <p className="text-[12px] text-muted-foreground">{message}</p>
    </div>
  );
}

/* ─── List Error (fetch 실패 + 재시도) ───────────────────────────── */
// 리스트/패널 조회 실패 시 일관된 에러 + 재시도 UI. 자산/정책의 인라인 패턴을 공용화.
export function ListError({ onRetry, fetching, message }: { onRetry: () => void; fetching?: boolean; message?: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-3">
      <div className="flex items-center gap-2 text-rose-600">
        <AlertCircle className="w-4 h-4" />
        <span className="text-[13px] font-medium">{message ?? t.common.loadFailed}</span>
      </div>
      <button
        onClick={onRetry}
        disabled={fetching}
        className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-md border border-border hover:bg-muted text-foreground/80 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
      >
        <RefreshCw className={`w-3 h-3 ${fetching ? "animate-spin" : ""}`} />
        {t.common.retry}
      </button>
    </div>
  );
}

/* ─── JSON Tree Viewer ──────────────────────────────────────────
   Syntax-highlighted, collapsible JSON tree (kmx-identityhub
   DID-document card style). Nodes are expanded by default; click a
   chevron to collapse. */
export function JsonTreeView({ data, className, search, baseCollapsed = false, resetToken }: {
  data: unknown; className?: string; search?: string; baseCollapsed?: boolean; resetToken?: number;
}) {
  // 노드별 펼침 override (key→open). baseCollapsed 가 기본값, override 가 우선. resetToken 변경 시 초기화.
  const [overrides, setOverrides] = React.useState<Map<string, boolean>>(new Map());
  React.useEffect(() => { setOverrides(new Map()); }, [resetToken]);

  const q = (search ?? "").trim().toLowerCase();
  const isOpen = (key: string) => (q ? true : overrides.has(key) ? !!overrides.get(key) : !baseCollapsed);
  const toggle = (key: string) =>
    setOverrides((prev) => { const next = new Map(prev); next.set(key, !isOpen(key)); return next; });

  // 검색어 하이라이트 (대소문자 무시)
  const hl = (text: string): React.ReactNode => {
    if (!q) return text;
    const lower = text.toLowerCase();
    if (!lower.includes(q)) return text;
    const out: React.ReactNode[] = [];
    let from = 0, idx = 0;
    while ((idx = lower.indexOf(q, from)) !== -1) {
      if (idx > from) out.push(text.slice(from, idx));
      out.push(<mark key={idx} className="bg-amber-400/30 text-amber-200 rounded-sm">{text.slice(idx, idx + q.length)}</mark>);
      from = idx + q.length;
    }
    if (from < text.length) out.push(text.slice(from));
    return out;
  };

  const renderValue = (value: unknown, key: string, indent: number): React.ReactNode => {
    if (Array.isArray(value)) {
      const open = isOpen(key);
      return (
        <span className="block">
          <button onClick={() => toggle(key)} className="text-slate-400 hover:text-slate-200 transition-colors">
            {open ? <ChevronDown size={10} className="inline" /> : <ChevronRight size={10} className="inline" />}
          </button>
          {" ["}
          {open ? (
            <>
              {value.map((item, i) => (
                <div key={i} style={{ paddingLeft: "16px" }}>
                  {typeof item === "object" && item !== null ? (
                    <span className="block">
                      {"{"}
                      {Object.entries(item as object).map(([k, v], j, arr) => (
                        <div key={k} style={{ paddingLeft: "16px" }}>
                          <span className="text-violet-400">"{hl(k)}"</span>
                          <span className="text-slate-400">: </span>
                          {renderValue(v, `${key}.${i}.${k}`, indent + 2)}
                          {j < arr.length - 1 && <span className="text-slate-500">,</span>}
                        </div>
                      ))}
                      <div>
                        {"}"}{i < value.length - 1 && <span className="text-slate-500">,</span>}
                      </div>
                    </span>
                  ) : (
                    <span>
                      {renderValue(item, `${key}.${i}`, indent + 1)}
                      {i < value.length - 1 && <span className="text-slate-500">,</span>}
                    </span>
                  )}
                </div>
              ))}
              <div>]</div>
            </>
          ) : (
            <span className="text-slate-500"> {value.length} items ]</span>
          )}
        </span>
      );
    }
    if (typeof value === "object" && value !== null) {
      const open = isOpen(key);
      const entries = Object.entries(value);
      return (
        <span className="block">
          <button onClick={() => toggle(key)} className="text-slate-400 hover:text-slate-200 transition-colors">
            {open ? <ChevronDown size={10} className="inline" /> : <ChevronRight size={10} className="inline" />}
          </button>
          {" {"}
          {open ? (
            <>
              {entries.map(([k, v], j) => (
                <div key={k} style={{ paddingLeft: "16px" }}>
                  <span className="text-violet-400">"{hl(k)}"</span>
                  <span className="text-slate-400">: </span>
                  {renderValue(v, `${key}.${k}`, indent + 1)}
                  {j < entries.length - 1 && <span className="text-slate-500">,</span>}
                </div>
              ))}
              <div>{"}"}</div>
            </>
          ) : (
            <span className="text-slate-500"> {entries.length} keys {"}"}</span>
          )}
        </span>
      );
    }
    if (typeof value === "string") return <span className="text-emerald-400 break-all">"{hl(value)}"</span>;
    if (value === null) return <span className="text-slate-500">null</span>;
    return <span className="text-amber-400">{hl(String(value))}</span>;
  };

  // overflow-wrap:anywhere(상속) → 긴 URN 등이 줄바꿈되고 inline 구조의 min-content 폭도 축소되어
  // 좁은 다이얼로그에서 가로 스크롤/값 잘림이 사라진다. 세로만 스크롤.
  const wrapCls = cn("bg-slate-900 rounded-xl p-4 font-mono text-[12px] text-slate-300 overflow-x-hidden overflow-y-auto [overflow-wrap:anywhere]", className);

  if (data === null || typeof data !== "object") {
    return (
      <div className={wrapCls}>
        {typeof data === "string"
          ? <span className="text-emerald-400 break-all">"{hl(data)}"</span>
          : data === null
            ? <span className="text-slate-500">null</span>
            : <span className="text-amber-400">{hl(String(data))}</span>}
      </div>
    );
  }

  return (
    <div className={wrapCls}>
      <span className="text-blue-400">{"{"}</span>
      {Object.entries(data).map(([key, value], i, arr) => (
        <div key={key} style={{ paddingLeft: "16px" }}>
          <span className="text-violet-400">"{hl(key)}"</span>
          <span className="text-slate-400">: </span>
          {renderValue(value, key, 1)}
          {i < arr.length - 1 && <span className="text-slate-500">,</span>}
        </div>
      ))}
      <span className="text-blue-400">{"}"}</span>
    </div>
  );
}
