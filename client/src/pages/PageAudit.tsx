// 감사 로그 (Audit Log) — Self-contained read-only audit trail viewer
// Filter by category / result / severity / time range, search by actor/target/action
// Click row → JSON detail | Export filtered set as CSV

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/i18n";
import { useConnectorStore } from "@/stores/connectorStore";
import {
  SectionHdr, Badge, MonoText,
  ListCard, ListHeaderRow, ListRow, ListColLabel, ListEmpty,
} from "@/components/ui-kmx";

const AUDIT_COLS = "grid-cols-[170px_1fr_1.7fr_0.9fr_1.5fr_0.9fr_0.9fr_1fr]";
import { DetailPanel } from "@/components/DetailDeleteDialogs";
import { DataTablePagination, usePagination } from "@/components/DataTablePagination";
import { Activity, Download, Search, ScrollText, Calendar, Filter, X, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

/* ─── Types ──────────────────────────────────────────────────── */
type AuditCategory =
  | "AUTH" | "ASSET" | "POLICY" | "OFFERING"
  | "NEGOTIATION" | "TRANSFER" | "VAULT" | "CONNECTOR" | "SYSTEM";
type AuditResult = "SUCCESS" | "FAILURE";
type AuditSeverity = "INFO" | "WARN" | "CRITICAL";

interface AuditEvent {
  id: string;
  timestamp: string;          // ISO
  actor: string;              // user id
  actorRole: "admin" | "operator" | "viewer" | "system";
  action: string;             // e.g. "asset.create"
  category: AuditCategory;
  target: string;             // resource id
  targetType: string;         // e.g. "Asset"
  result: AuditResult;
  severity: AuditSeverity;
  ip: string;
  userAgent: string;
  requestId: string;
  message: string;
  payload?: Record<string, unknown>;
}

/* ─── Demo data factory ──────────────────────────────────────── */
function makeDemoEvents(connectorId: string, locale: string): AuditEvent[] {
  const isProd = connectorId.toLowerCase().includes("prod");
  const baseDate = Date.now();
  const min = 60_000;

  const tpl: (Omit<AuditEvent, "id" | "timestamp" | "requestId"> & { messageEn: string })[] = [
    { actor: "admin",     actorRole: "admin",    action: "auth.login",                category: "AUTH",        target: "admin",                                                  targetType: "User",        result: "SUCCESS", severity: "INFO",     ip: "10.0.12.41",  userAgent: "Mozilla/5.0 Chrome/124", message: "관리자 로그인 성공", messageEn: "Admin login successful" },
    { actor: "operator",  actorRole: "operator", action: "asset.create",              category: "ASSET",       target: "kmx-test-asset-1777709569",                              targetType: "Asset",       result: "SUCCESS", severity: "INFO",     ip: "10.0.12.55",  userAgent: "Mozilla/5.0 Chrome/124", message: "자산 생성", messageEn: "Asset created", payload: { id: "kmx-test-asset-1777709569", type: "data", baseUrl: "https://kmx-prod-01/api/data" } },
    { actor: "operator",  actorRole: "operator", action: "policy.create",             category: "POLICY",      target: "policy-membership-cx",                                   targetType: "Policy",      result: "SUCCESS", severity: "INFO",     ip: "10.0.12.55",  userAgent: "Mozilla/5.0 Chrome/124", message: "ODRL 정책 생성", messageEn: "ODRL policy created", payload: { id: "policy-membership-cx", action: "use", constraints: 1 } },
    { actor: "operator",  actorRole: "operator", action: "offering.publish",          category: "OFFERING",    target: "offering-2025-batch-001",                                targetType: "Offering",    result: "SUCCESS", severity: "INFO",     ip: "10.0.12.55",  userAgent: "Mozilla/5.0 Chrome/124", message: "계약 게시", messageEn: "Contract offering published" },
    { actor: "consumer-bpn", actorRole: "system", action: "negotiation.requested",    category: "NEGOTIATION", target: "neg-7c9e4d11-aa02",                                      targetType: "Negotiation", result: "SUCCESS", severity: "INFO",     ip: "203.0.113.7", userAgent: "EDC/0.7.2 Java/17", message: "협상 요청 수신", messageEn: "Negotiation request received" },
    { actor: "consumer-bpn", actorRole: "system", action: "negotiation.finalized",    category: "NEGOTIATION", target: "neg-7c9e4d11-aa02",                                      targetType: "Negotiation", result: "SUCCESS", severity: "INFO",     ip: "203.0.113.7", userAgent: "EDC/0.7.2 Java/17", message: "계약 성립", messageEn: "Contract agreement finalized" },
    { actor: "consumer-bpn", actorRole: "system", action: "transfer.started",         category: "TRANSFER",    target: "tp-f02a18b3-9c41",                                       targetType: "Transfer",    result: "SUCCESS", severity: "INFO",     ip: "203.0.113.7", userAgent: "EDC/0.7.2 Java/17", message: "전송 시작 (HttpData)", messageEn: "Transfer started (HttpData)" },
    { actor: "consumer-bpn", actorRole: "system", action: "transfer.completed",       category: "TRANSFER",    target: "tp-f02a18b3-9c41",                                       targetType: "Transfer",    result: "SUCCESS", severity: "INFO",     ip: "203.0.113.7", userAgent: "EDC/0.7.2 Java/17", message: "전송 완료 (1.2 MB)", messageEn: "Transfer completed (1.2 MB)" },
    { actor: "operator",  actorRole: "operator", action: "vault.key.rotate",          category: "VAULT",       target: "edc:key:dsp-signing",                                    targetType: "VaultKey",    result: "SUCCESS", severity: "WARN",     ip: "10.0.12.55",  userAgent: "Mozilla/5.0 Chrome/124", message: "Ed25519 서명 키 회전", messageEn: "Ed25519 signing key rotated" },
    { actor: "system",    actorRole: "system",   action: "edr.gc.deleted",            category: "SYSTEM",      target: "edr-gc-batch-2026050801",                                targetType: "EdrBatch",    result: "SUCCESS", severity: "INFO",     ip: "127.0.0.1",   userAgent: "kmx-scheduler/1.0",      message: "EDR GC 12건 삭제", messageEn: "EDR GC deleted 12 entries" },
    { actor: "consumer-bpn-bad", actorRole: "system", action: "auth.dsp.token",      category: "AUTH",        target: "did:web:example.org:bad",                                targetType: "DID",         result: "FAILURE", severity: "WARN",     ip: "198.51.100.9",userAgent: "EDC/0.6.x Java/17",     message: "STS 토큰 검증 실패 (issuer 미신뢰)", messageEn: "STS token validation failed (untrusted issuer)" },
    { actor: "consumer-bpn", actorRole: "system", action: "negotiation.terminated",   category: "NEGOTIATION", target: "neg-3a91c4ee-bb77",                                      targetType: "Negotiation", result: "FAILURE", severity: "WARN",     ip: "203.0.113.7", userAgent: "EDC/0.7.2 Java/17", message: "협상 종료 — Counter-offer 거절", messageEn: "Negotiation terminated — counter-offer rejected" },
    { actor: "operator",  actorRole: "operator", action: "asset.delete",              category: "ASSET",       target: "obsolete-asset-001",                                     targetType: "Asset",       result: "SUCCESS", severity: "INFO",     ip: "10.0.12.55",  userAgent: "Mozilla/5.0 Chrome/124", message: "자산 삭제", messageEn: "Asset deleted" },
    { actor: "viewer",    actorRole: "viewer",   action: "policy.delete",             category: "POLICY",      target: "policy-restricted-eu",                                   targetType: "Policy",      result: "FAILURE", severity: "CRITICAL", ip: "10.0.12.71",  userAgent: "Mozilla/5.0 Safari/17", message: "권한 없음 — viewer가 삭제 시도", messageEn: "Permission denied — viewer attempted deletion" },
    { actor: "admin",     actorRole: "admin",    action: "connector.update",          category: "CONNECTOR",   target: connectorId,                                              targetType: "Connector",   result: "SUCCESS", severity: "INFO",     ip: "10.0.12.41",  userAgent: "Mozilla/5.0 Chrome/124", message: "커넥터 정보 수정", messageEn: "Connector info updated" },
    { actor: "system",    actorRole: "system",   action: "vc.expiry.warn",            category: "SYSTEM",      target: "MembershipCredential",                                   targetType: "VC",          result: "SUCCESS", severity: "WARN",     ip: "127.0.0.1",   userAgent: "kmx-scheduler/1.0",      message: "MembershipCredential 23일 후 만료", messageEn: "MembershipCredential expires in 23 days" },
    { actor: "consumer-bpn", actorRole: "system", action: "transfer.terminated",      category: "TRANSFER",    target: "tp-77ee99cc-1f01",                                       targetType: "Transfer",    result: "FAILURE", severity: "CRITICAL", ip: "203.0.113.7", userAgent: "EDC/0.7.2 Java/17", message: "전송 실패 — Sink 응답 5xx", messageEn: "Transfer failed — sink responded 5xx" },
    { actor: "operator",  actorRole: "operator", action: "policy.update",             category: "POLICY",      target: "policy-membership-cx",                                   targetType: "Policy",      result: "SUCCESS", severity: "INFO",     ip: "10.0.12.55",  userAgent: "Mozilla/5.0 Chrome/124", message: "정책 제약 조건 추가", messageEn: "Policy constraint added" },
    { actor: "operator",  actorRole: "operator", action: "offering.update",           category: "OFFERING",    target: "offering-2025-batch-001",                                targetType: "Offering",    result: "SUCCESS", severity: "INFO",     ip: "10.0.12.55",  userAgent: "Mozilla/5.0 Chrome/124", message: "계약 수정 — 자산 추가", messageEn: "Contract offering updated — asset added" },
    { actor: "admin",     actorRole: "admin",    action: "vault.secret.delete",       category: "VAULT",       target: "edc:secret:legacy-token",                                targetType: "VaultSecret", result: "SUCCESS", severity: "WARN",     ip: "10.0.12.41",  userAgent: "Mozilla/5.0 Chrome/124", message: "레거시 시크릿 삭제", messageEn: "Legacy secret deleted" },
    { actor: "admin",     actorRole: "admin",    action: "auth.login",                category: "AUTH",        target: "admin",                                                  targetType: "User",        result: "FAILURE", severity: "CRITICAL", ip: "45.77.12.4",  userAgent: "curl/8.5",              message: "비밀번호 불일치 (시도 3회)", messageEn: "Password mismatch (3 attempts)" },
    { actor: "system",    actorRole: "system",   action: "connector.health.degraded", category: "CONNECTOR",   target: isProd ? "kmx-prod-01" : "kmx-cons-01",                   targetType: "Connector",   result: "FAILURE", severity: "WARN",     ip: "127.0.0.1",   userAgent: "kmx-monitor/1.0",        message: "DSP readiness probe 실패", messageEn: "DSP readiness probe failed" },
    { actor: "consumer-bpn", actorRole: "system", action: "negotiation.requested",    category: "NEGOTIATION", target: "neg-aa11bb22-cc33",                                      targetType: "Negotiation", result: "SUCCESS", severity: "INFO",     ip: "203.0.113.8", userAgent: "EDC/0.7.2 Java/17", message: "협상 요청 수신", messageEn: "Negotiation request received" },
    { actor: "operator",  actorRole: "operator", action: "asset.update",              category: "ASSET",       target: "kmx-test-asset-1777709569",                              targetType: "Asset",       result: "SUCCESS", severity: "INFO",     ip: "10.0.12.55",  userAgent: "Mozilla/5.0 Chrome/124", message: "자산 메타데이터 업데이트", messageEn: "Asset metadata updated" },
    { actor: "admin",     actorRole: "admin",    action: "auth.logout",               category: "AUTH",        target: "admin",                                                  targetType: "User",        result: "SUCCESS", severity: "INFO",     ip: "10.0.12.41",  userAgent: "Mozilla/5.0 Chrome/124", message: "로그아웃", messageEn: "Logout" },
  ];

  // Repeat the base 25 templates 3x with different timestamps (~75 events) so
  // pagination is exercised meaningfully in dev/demo mode.
  const REPEAT = 3;
  const events: AuditEvent[] = [];
  for (let r = 0; r < REPEAT; r++) {
    tpl.forEach((e, i) => {
      const seq = r * tpl.length + i;
      const ts = new Date(baseDate - r * 24 * 60 * min - i * 11 * min - Math.floor(Math.random() * 90) * min);
      const { messageEn, ...rest } = e;
      events.push({
        ...rest,
        message: locale === "en" ? messageEn : rest.message,
        id: `evt-${(2026050800 - seq).toString(16)}`,
        timestamp: ts.toISOString(),
        requestId: `req-${Math.random().toString(36).slice(2, 10)}`,
      });
    });
  }
  return events;
}

/* ─── Helpers ────────────────────────────────────────────────── */
function formatTs(iso: string) {
  const d = new Date(iso);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

const CAT_VARIANT: Record<AuditCategory, "blue" | "teal" | "purple" | "amber" | "sky" | "green" | "gray"> = {
  AUTH:        "purple",
  ASSET:       "blue",
  POLICY:      "teal",
  OFFERING:    "sky",
  NEGOTIATION: "amber",
  TRANSFER:    "green",
  VAULT:       "purple",
  CONNECTOR:   "blue",
  SYSTEM:      "gray",
};

function severityBadge(sev: AuditSeverity, t: ReturnType<typeof useI18n>["t"]) {
  if (sev === "CRITICAL") return <Badge variant="red"><AlertTriangle className="w-3 h-3" />{t.audit.severityCritical}</Badge>;
  if (sev === "WARN")     return <Badge variant="amber"><AlertTriangle className="w-3 h-3" />{t.audit.severityWarn}</Badge>;
  return <Badge variant="gray">{t.audit.severityInfo}</Badge>;
}

function resultBadge(r: AuditResult, t: ReturnType<typeof useI18n>["t"]) {
  return r === "SUCCESS"
    ? <Badge variant="green"><CheckCircle2 className="w-3 h-3" />{t.audit.resultSuccess}</Badge>
    : <Badge variant="red"><XCircle className="w-3 h-3" />{t.audit.resultFailure}</Badge>;
}

function withinRange(iso: string, range: "ALL" | "1D" | "7D" | "30D") {
  if (range === "ALL") return true;
  const days = range === "1D" ? 1 : range === "7D" ? 7 : 30;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return new Date(iso).getTime() >= cutoff;
}

/* ─── CSV Export ─────────────────────────────────────────────── */
function exportCsv(rows: AuditEvent[]) {
  const header = ["id", "timestamp", "actor", "actorRole", "action", "category", "target", "targetType", "result", "severity", "ip", "requestId", "message"];
  const escape = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    header.join(","),
    ...rows.map((r) => header.map((h) => escape((r as unknown as Record<string, unknown>)[h])).join(",")),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ─── Page ───────────────────────────────────────────────────── */
const CATEGORIES: ("ALL" | AuditCategory)[] = ["ALL", "AUTH", "ASSET", "POLICY", "OFFERING", "NEGOTIATION", "TRANSFER", "VAULT", "CONNECTOR", "SYSTEM"];

export default function PageAudit() {
  const { t, locale } = useI18n();
  const connector = useConnectorStore((s) => s.connector);
  const connectorId = connector?.id ?? "kmx-prod-01";

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<"ALL" | AuditCategory>("ALL");
  const [result, setResult] = useState<"ALL" | AuditResult>("ALL");
  const [severity, setSeverity] = useState<"ALL" | AuditSeverity>("ALL");
  const [range, setRange] = useState<"ALL" | "1D" | "7D" | "30D">("ALL");
  const [selected, setSelected] = useState<AuditEvent | null>(null);

  const allEvents = useMemo(() => makeDemoEvents(connectorId, locale), [connectorId, locale]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allEvents.filter((e) => {
      if (category !== "ALL" && e.category !== category) return false;
      if (result !== "ALL" && e.result !== result) return false;
      if (severity !== "ALL" && e.severity !== severity) return false;
      if (!withinRange(e.timestamp, range)) return false;
      if (q) {
        const haystack = `${e.actor} ${e.action} ${e.target} ${e.message}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [allEvents, search, category, result, severity, range]);

  const { paginatedData, totalItems, currentPage, pageSize, setCurrentPage, setPageSize } = usePagination(filtered, 10);

  // Reset page when filters change so users always see page 1 of new results.
  useEffect(() => {
    setCurrentPage(1);
  }, [search, category, result, severity, range, setCurrentPage]);

  const catLabel: Record<"ALL" | AuditCategory, string> = {
    ALL: t.audit.catAll,
    AUTH: t.audit.catAuth,
    ASSET: t.audit.catAsset,
    POLICY: t.audit.catPolicy,
    OFFERING: t.audit.catOffering,
    NEGOTIATION: t.audit.catNegotiation,
    TRANSFER: t.audit.catTransfer,
    VAULT: t.audit.catVault,
    CONNECTOR: t.audit.catConnector,
    SYSTEM: t.audit.catSystem,
  };

  const hasActiveFilter =
    !!search || category !== "ALL" || result !== "ALL" || severity !== "ALL" || range !== "ALL";

  return (
    <>
      <SectionHdr
        icon={<ScrollText className="w-5 h-5 text-primary" />}
        breadcrumb={t.audit.subtitle}
      >
        {t.audit.title}
      </SectionHdr>

      {/* Filter Bar 1 — search + range + export */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.audit.searchPlaceholder}
            className="w-full pl-8 pr-8 py-1.5 text-[12px] border border-border rounded-md bg-card text-foreground placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-primary"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
              aria-label={t.common.clear ?? "Clear"}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5 ml-auto">
          <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
          {(["ALL", "1D", "7D", "30D"] as const).map((r) => (
            <RangeBtn key={r} active={range === r} onClick={() => setRange(r)}>
              {r === "ALL" ? t.audit.rangeAll : r === "1D" ? t.audit.range1d : r === "7D" ? t.audit.range7d : t.audit.range30d}
            </RangeBtn>
          ))}
        </div>
        <button
          onClick={() => { exportCsv(filtered); toast.success(t.audit.exported); }}
          disabled={filtered.length === 0}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-primary focus-visible:ring-offset-1"
        >
          <Download className="w-3.5 h-3.5" /> {t.audit.exportCsv}
        </button>
      </div>

      {/* Filter Bar 2 — category */}
      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
        <span className="text-[11px] font-medium text-muted-foreground">{t.audit.filterCategory}</span>
        <div className="flex gap-1.5 flex-wrap">
          {CATEGORIES.map((c) => (
            <FilterPill key={c} active={category === c} onClick={() => setCategory(c)}>
              {catLabel[c]}
            </FilterPill>
          ))}
        </div>
      </div>

      {/* Filter Bar 3 — result / severity + clear */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] font-medium text-muted-foreground">{t.audit.filterResult}</span>
          {(["ALL", "SUCCESS", "FAILURE"] as const).map((r) => (
            <FilterPill key={r} active={result === r} onClick={() => setResult(r)}>
              {r === "ALL" ? t.common.all : r === "SUCCESS" ? t.audit.resultSuccess : t.audit.resultFailure}
            </FilterPill>
          ))}
        </div>
        <span className="text-muted-foreground/40 text-xs">·</span>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] font-medium text-muted-foreground">{t.audit.filterSeverity}</span>
          {(["ALL", "INFO", "WARN", "CRITICAL"] as const).map((s) => (
            <FilterPill key={s} active={severity === s} onClick={() => setSeverity(s)}>
              {s === "ALL" ? t.common.all : s === "INFO" ? t.audit.severityInfo : s === "WARN" ? t.audit.severityWarn : t.audit.severityCritical}
            </FilterPill>
          ))}
        </div>
        {hasActiveFilter && (
          <button
            onClick={() => { setSearch(""); setCategory("ALL"); setResult("ALL"); setSeverity("ALL"); setRange("ALL"); }}
            className="ml-auto inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium text-muted-foreground hover:text-red-500 hover:bg-red-50 transition-colors"
          >
            <X className="w-3 h-3" />{t.audit.clearFilters}
          </button>
        )}
      </div>

      {/* List — Desktop */}
      <ListCard
        title={t.audit.listTitle}
        className="hidden md:block"
      >
        {filtered.length === 0 ? (
          <ListEmpty
            icon={<Activity />}
            message={
              <>
                <span className="block text-[15px] font-semibold text-foreground mb-1">{t.audit.emptyTitle}</span>
                {t.audit.emptyDesc}
              </>
            }
          />
        ) : (
          <>
            <ListHeaderRow cols={AUDIT_COLS}>
              <ListColLabel>{t.audit.col.timestamp}</ListColLabel>
              <ListColLabel>{t.audit.col.actor}</ListColLabel>
              <ListColLabel>{t.audit.col.action}</ListColLabel>
              <ListColLabel>{t.audit.col.category}</ListColLabel>
              <ListColLabel className="hidden lg:block">{t.audit.col.target}</ListColLabel>
              <ListColLabel>{t.audit.col.result}</ListColLabel>
              <ListColLabel className="hidden xl:block">{t.audit.col.severity}</ListColLabel>
              <ListColLabel className="hidden xl:block">{t.audit.col.ip}</ListColLabel>
            </ListHeaderRow>
            {paginatedData.map((e) => (
              <ListRow
                key={e.id}
                cols={AUDIT_COLS}
                onClick={() => setSelected(e)}
                className={e.result === "FAILURE" || e.severity === "CRITICAL" ? "border-l-rose-400 bg-rose-50/30" : undefined}
              >
                <div>
                  <span className="text-xs text-foreground" title={new Date(e.timestamp).toLocaleString()}>{formatTs(e.timestamp)}</span>
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-foreground truncate">{e.actor}</p>
                  <p className="text-[11px] text-muted-foreground">{e.actorRole}</p>
                </div>
                <div className="min-w-0">
                  <span className="text-xs font-bold text-primary block truncate">{e.action}</span>
                  <p className="text-[11px] text-muted-foreground truncate">{e.message}</p>
                </div>
                <div>
                  <Badge variant={CAT_VARIANT[e.category]}>{catLabel[e.category]}</Badge>
                </div>
                <div className="hidden lg:block min-w-0">
                  <span className="text-xs text-foreground block truncate">{e.target}</span>
                  <p className="text-[11px] font-normal text-muted-foreground">{e.targetType}</p>
                </div>
                <div>{resultBadge(e.result, t)}</div>
                <div className="hidden xl:block">{severityBadge(e.severity, t)}</div>
                <div className="hidden xl:block">
                  <span className="text-xs text-foreground">{e.ip}</span>
                </div>
              </ListRow>
            ))}
          </>
        )}

        {/* Pagination (desktop) */}
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

      {/* List — Mobile */}
      <div className="md:hidden flex flex-col gap-2">
        {filtered.length === 0 ? (
          <div className="py-8 text-center text-[13px] text-muted-foreground">{t.audit.emptyTitle}</div>
        ) : (
          paginatedData.map((e) => (
            <div
              key={e.id}
              onClick={() => setSelected(e)}
              role="button"
              tabIndex={0}
              onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); setSelected(e); } }}
              className={`bg-card rounded-xl p-3 shadow-sm border border-border border-l-2 active:bg-muted/40 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary ${
                e.result === "FAILURE" || e.severity === "CRITICAL" ? "border-l-rose-400 bg-rose-50/30" : "border-l-transparent"
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <Badge variant={CAT_VARIANT[e.category]}>{catLabel[e.category]}</Badge>
                <div className="flex items-center gap-1">
                  {resultBadge(e.result, t)}
                  {severityBadge(e.severity, t)}
                </div>
              </div>
              <span className="text-xs font-bold text-primary block">{e.action}</span>
              <p className="text-[12px] text-muted-foreground mt-0.5 truncate">{e.message}</p>
              <div className="flex items-center justify-between mt-2 text-[11px] text-muted-foreground">
                <span title={new Date(e.timestamp).toLocaleString()}><MonoText className="text-[11px] font-normal">{formatTs(e.timestamp)}</MonoText></span>
                <span className="font-normal">{e.actor}</span>
              </div>
            </div>
          ))
        )}

        {/* Pagination (mobile) */}
        {totalItems > 0 && (
          <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
            <DataTablePagination
              totalItems={totalItems}
              pageSize={pageSize}
              currentPage={currentPage}
              onPageChange={setCurrentPage}
              onPageSizeChange={setPageSize}
              rowsPerPageLabel={t.common.rowsPerPage}
            />
          </div>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground/70">{t.audit.retentionNotice}</p>

      {/* Detail Panel */}
      {selected && (
        <DetailPanel
          open={!!selected}
          onClose={() => setSelected(null)}
          title={t.audit.detailTitle}
          icon={<ScrollText className="w-5 h-5 text-primary flex-shrink-0" />}
          sections={[
            {
              title: t.audit.field.timestamp,
              fields: [
                { label: t.audit.field.eventId, value: selected.id, mono: true, copyable: true },
                { label: t.audit.field.timestamp, value: formatTs(selected.timestamp), mono: true },
                { label: t.audit.field.requestId, value: selected.requestId, mono: true, copyable: true },
                { label: t.audit.field.category, value: catLabel[selected.category], badge: { text: catLabel[selected.category], variant: CAT_VARIANT[selected.category] === "sky" ? "blue" : (CAT_VARIANT[selected.category] as "blue" | "green" | "amber" | "gray" | "red" | "purple") } },
              ],
            },
            {
              title: t.audit.field.actor,
              fields: [
                { label: t.audit.field.actor, value: selected.actor, mono: true },
                { label: t.audit.field.actorRole, value: selected.actorRole },
                { label: t.audit.field.ip, value: selected.ip, mono: true, copyable: true },
                { label: t.audit.field.userAgent, value: selected.userAgent, mono: true },
              ],
            },
            {
              title: t.audit.field.action,
              fields: [
                { label: t.audit.field.action, value: selected.action, mono: true, copyable: true },
                { label: t.audit.field.target, value: selected.target, mono: true, copyable: true },
                { label: t.audit.field.targetType, value: selected.targetType },
                {
                  label: t.audit.field.result,
                  value: selected.result === "SUCCESS" ? t.audit.resultSuccess : t.audit.resultFailure,
                  badge: { text: selected.result === "SUCCESS" ? t.audit.resultSuccess : t.audit.resultFailure, variant: selected.result === "SUCCESS" ? "green" : "red" },
                },
                {
                  label: t.audit.field.severity,
                  value: selected.severity === "CRITICAL" ? t.audit.severityCritical : selected.severity === "WARN" ? t.audit.severityWarn : t.audit.severityInfo,
                  badge: {
                    text: selected.severity === "CRITICAL" ? t.audit.severityCritical : selected.severity === "WARN" ? t.audit.severityWarn : t.audit.severityInfo,
                    variant: selected.severity === "CRITICAL" ? "red" : selected.severity === "WARN" ? "amber" : "gray",
                  },
                },
                { label: t.audit.field.message, value: selected.message },
                ...(selected.payload
                  ? [{
                      label: t.audit.field.payload,
                      value: "",
                      json: selected.payload,
                    } as const]
                  : []),
              ],
            },
          ]}
        />
      )}
    </>
  );
}

/* ─── Filter primitives ──────────────────────────────────────── */
function FilterPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-[11px] font-medium border transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary ${
        active
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-card border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
      }`}
    >
      {children}
    </button>
  );
}

function RangeBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary ${
        active
          ? "bg-primary/10 text-primary border-primary/30"
          : "bg-card border-border text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
