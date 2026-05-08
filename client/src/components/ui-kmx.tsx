// Connector Hub — Shared UI Primitives
// Design: Admin Console style | Dark navy sidebar + white cards + light gray bg

import { cn } from "@/lib/utils";
import { X, AlertTriangle, Info, AlertCircle, CheckCircle2, TrendingUp, Check, ChevronRight } from "lucide-react";
import React from "react";

/* ─── Badge ─────────────────────────────────────────────────── */
type BadgeVariant = "green" | "blue" | "teal" | "amber" | "red" | "purple" | "gray" | "outline" | "sky";

const BADGE_STYLES: Record<BadgeVariant, string> = {
  sky:     "bg-sky-50 text-sky-700 border-sky-200",
  green:   "bg-emerald-50 text-emerald-700 border-emerald-200",
  blue:    "bg-blue-50 text-blue-700 border-blue-200",
  teal:    "bg-teal-50 text-teal-700 border-teal-200",
  amber:   "bg-amber-50 text-amber-700 border-amber-200",
  red:     "bg-rose-50 text-rose-700 border-rose-200",
  purple:  "bg-violet-50 text-violet-700 border-violet-200",
  gray:    "bg-slate-50 text-slate-600 border-slate-200",
  outline: "bg-transparent text-foreground border-border",
};

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
  pulse?: boolean;
}

export function Badge({ children, variant = "gray", className, pulse }: BadgeProps) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium border whitespace-nowrap",
      BADGE_STYLES[variant],
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
export function StatusPill({ status = "down" }: { status?: "up" | "warn" | "down" }) {
  const map = {
    up:   { dot: "bg-emerald-500", label: "UP",   cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    warn: { dot: "bg-amber-500",   label: "WARN", cls: "bg-amber-50 text-amber-700 border-amber-200" },
    down: { dot: "bg-rose-500",    label: "DOWN", cls: "bg-rose-50 text-rose-700 border-rose-200" },
  };
  const { dot, label, cls } = map[status] ?? map.down;
  return (
    <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium border", cls)}>
      <span className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", dot, status === "warn" && "status-pulse")} />
      {label}
    </span>
  );
}

/* ─── KPI Card — large number style (matching image) ─────────── */
interface KpiCardProps {
  label: string;
  value: string | number;
  sub?: string;
  colorClass?: string;
  valueColor?: string;
  icon?: React.ReactNode;
  iconBg?: string;
  trend?: "up" | "down" | "neutral";
  iconColor?: string;
  loading?: boolean;
}

export function KpiCard({ label, value, sub, colorClass, valueColor, icon, iconBg, trend, iconColor, loading }: KpiCardProps) {
  return (
    <div className="bg-card rounded-xl p-5 flex flex-col gap-2 shadow-sm border border-border hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        {icon && (
          <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center", iconBg ?? iconColor ?? "bg-blue-50")}>
            {icon}
          </div>
        )}
        {trend && (
          <TrendingUp className={cn(
            "w-4 h-4",
            trend === "up" ? "text-emerald-500" : trend === "down" ? "text-rose-500" : "text-muted-foreground"
          )} />
        )}
      </div>
      {loading ? (
        <div className="h-9 w-16 bg-muted animate-pulse rounded mt-1" />
      ) : (
        <div className={cn("font-display text-3xl font-bold kpi-value leading-none mt-1", valueColor ?? colorClass ?? "text-foreground")}>
          {value}
        </div>
      )}
      <div className="text-[13px] font-medium text-foreground/80">{label}</div>
      {sub && <div className="text-[12px] text-muted-foreground">{sub}</div>}
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
        <div className="font-display text-[15px] font-semibold text-foreground">{name}</div>
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
}

export function SectionHdr({ children, action, breadcrumb }: SectionHdrProps) {
  return (
    <div className="mb-1">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-foreground dark:text-white whitespace-nowrap">{children}</h1>
        {action}
      </div>
      {breadcrumb && (
        <div className="text-[12px] text-foreground/70 dark:text-white/70 mt-0.5">{breadcrumb}</div>
      )}
      <div className="h-px bg-border mt-1.5" />
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
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <span className="font-display text-[13px] font-semibold text-foreground/80">{title}</span>
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
}

export function FormField({ label, children, required }: FormFieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[12px] font-medium text-foreground/70">
        {label}{required && <span className="text-rose-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

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
        "flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-semibold transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed",
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
        "flex items-center gap-0.5 text-[11px] text-blue-500 hover:text-blue-700 transition-colors",
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
        "flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors",
        className,
      )}
    >
      {icon}
      {children}
    </button>
  );
}
