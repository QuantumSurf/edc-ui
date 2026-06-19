// Connector Hub — Fleet Overview (spec 4.1)
// Multi-connector home with KPI aggregation, service health, connector grid

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { type Connector } from "@/lib/data";
import { fetchFleetKPI, fetchConnectors, updateConnector, deleteConnector, testConnection } from "@/services";
import { SectionHdr, Badge, StatusPill, EnvBadge, KpiCard, FormField, PrimaryActionButton, inputBase, ListError, ListEmpty, AlertBanner } from "@/components/ui-kmx";
import { SlidePanel, DeleteConfirmDialog } from "@/components/DetailDeleteDialogs";
import {
  PlusCircle, Database, Package, FileText, ArrowRightLeft,
  CheckCircle2, XCircle, Shield, Server,
  Pencil, Trash2, Loader2, LayoutGrid, Search, X,
} from "lucide-react";
import { toast } from "sonner";
import { RoleGate } from "@/components/RoleGate";
import { useAuth } from "@/contexts/AuthContext";
import AddConnectorPanel from "./PageAddConnector";

interface PageFleetProps {
  onSelect: (c: Connector, page?: string) => void;
  onNav: (path: string) => void;
}

const ROLE_MAP: Record<string, string[]> = {
  both: ["Provider", "Consumer"],
  provider: ["Provider"],
  consumer: ["Consumer"],
};

function rolesToKey(roles: string[]): string {
  if (roles.includes("Provider") && roles.includes("Consumer")) return "both";
  if (roles.includes("Provider")) return "provider";
  return "consumer";
}

export default function PageFleet({ onSelect, onNav }: PageFleetProps) {
  const { t } = useI18n();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Add connector slide panel state
  const [addOpen, setAddOpen] = useState(false);

  // Edit dialog state
  const [editTarget, setEditTarget] = useState<Connector | null>(null);

  // Delete dialog state
  const [deleteTarget, setDeleteTarget] = useState<Connector | null>(null);

  // 커넥터 검색(이름/BPN)
  const [search, setSearch] = useState("");

  const { data: kpi, isLoading: kpiLoading, isError: kpiError, refetch: kpiRefetch } = useQuery({
    queryKey: ["fleet-kpi"],
    queryFn: fetchFleetKPI,
    refetchInterval: 60_000,
    retry: 3,
    retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 8_000),
    staleTime: 0,
  });
  // KPI 조회 실패 시 0(오정보) 대신 "—" 표시
  const kpiVal = (n: number | undefined) => (kpiError ? "—" : (n ?? 0));

  const { data: connectors = [], isLoading: connectorsLoading, isError: connectorsError, refetch: connectorsRefetch, isFetching: connectorsFetching } = useQuery({
    queryKey: ["connectors"],
    queryFn: fetchConnectors,
    refetchInterval: 60_000,
    retry: 3,
    staleTime: 0,
  });

  const list = Array.isArray(connectors) ? connectors : [];
  const q = search.trim().toLowerCase();
  const filtered = q
    ? list.filter((c) => `${c.name} ${c.bpn}`.toLowerCase().includes(q))
    : list;


  return (
    <>
      {/* Section Header (KPI 카드는 이 "커넥터 플릿" 제목 아래에 표시) */}
      <SectionHdr
        icon={<LayoutGrid className="w-5 h-5 text-primary" />}
        breadcrumb={user?.tenantName || undefined}
        action={
        <RoleGate permission="connector:write">
          <PrimaryActionButton onClick={() => setAddOpen(true)} icon={<PlusCircle className="w-3 h-3" />}>
            {t.common.addConnector}
          </PrimaryActionButton>
        </RoleGate>
      }>
        {t.fleet.connectorFleet}
      </SectionHdr>

      {/* KPI 조회 실패 배너 (값은 "—"로 표시되어 오정보 방지) */}
      {kpiError && (
        <AlertBanner variant="warn">
          <span className="inline-flex flex-wrap items-center gap-2">
            {t.fleet.kpiLoadFailed}
            <button onClick={() => kpiRefetch()} className="underline underline-offset-2 hover:no-underline font-medium">
              {t.common.retry}
            </button>
          </span>
        </AlertBanner>
      )}

      {/* KPI Row — 커넥터 플릿 제목 바로 아래 */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        <KpiCard icon={<Server className="w-[18px] h-[18px] text-blue-600 dark:text-blue-400" />} iconBg="bg-blue-50 dark:bg-blue-500/10" value={kpiVal(kpi?.totalConnectors)} label={t.fleet.totalConnectors} loading={kpiLoading} />
        <KpiCard icon={<CheckCircle2 className="w-[18px] h-[18px] text-emerald-600 dark:text-emerald-400" />} iconBg="bg-emerald-50 dark:bg-emerald-500/10" value={kpiVal(kpi?.up)} label={t.fleet.healthy} valueColor="text-emerald-600 dark:text-emerald-400" loading={kpiLoading} />
        <KpiCard icon={<Shield className="w-[18px] h-[18px] text-amber-600 dark:text-amber-400" />} iconBg="bg-amber-50 dark:bg-amber-500/10" value={kpiVal(kpi?.warn)} label={t.fleet.warning} sub={t.fleet.needsCheck} valueColor="text-amber-600 dark:text-amber-400" loading={kpiLoading} />
        <KpiCard icon={<XCircle className="w-[18px] h-[18px] text-rose-600 dark:text-rose-400" />} iconBg="bg-rose-50 dark:bg-rose-500/10" value={kpiVal(kpi?.down)} label={t.fleet.down} valueColor="text-rose-600 dark:text-rose-400" loading={kpiLoading} />
        <KpiCard icon={<ArrowRightLeft className="w-[18px] h-[18px] text-sky-600 dark:text-sky-400" />} iconBg="bg-sky-50 dark:bg-sky-500/10" value={kpiVal(kpi?.totalTransfers)} label={t.fleet.todayTransfers} sub={kpiError ? undefined : t.fleet.assetsRegistered(kpi?.totalAssets ?? 0)} valueColor="text-sky-600 dark:text-sky-400" loading={kpiLoading} />
      </div>

      {/* 검색 (커넥터가 있을 때만) */}
      {!connectorsLoading && !connectorsError && list.length > 0 && (
        <div className="relative max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.fleet.searchPlaceholder}
            aria-label={t.fleet.searchPlaceholder}
            className={`${inputBase} pl-8 pr-8`}
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              aria-label={t.common.close}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Connector Grid / 상태 분기 */}
      {connectorsLoading ? (
        <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-[13px]">{t.common.loading}</span>
        </div>
      ) : connectorsError ? (
        <ListError onRetry={() => connectorsRefetch()} fetching={connectorsFetching} />
      ) : list.length === 0 ? (
        <div className="py-10 flex flex-col items-center gap-4">
          <ListEmpty
            icon={<Server />}
            message={
              <>
                <span className="block text-[14px] font-semibold text-foreground mb-1">{t.fleet.noConnectors}</span>
                <span className="block max-w-md mx-auto">{t.fleet.emptyHelp}</span>
              </>
            }
          />
          <RoleGate permission="connector:write">
            <PrimaryActionButton onClick={() => setAddOpen(true)} icon={<PlusCircle className="w-3 h-3" />}>
              {t.common.addConnector}
            </PrimaryActionButton>
          </RoleGate>
        </div>
      ) : filtered.length === 0 ? (
        <ListEmpty icon={<Search />} message={t.fleet.noSearchResults} />
      ) : (
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
        {filtered.map((c) => (
          <ConnectorCard
            key={c.id}
            connector={c}
            onOpen={(page) => onSelect(c, page)}
            onEdit={() => setEditTarget(c)}
            onDelete={() => setDeleteTarget(c)}
          />
        ))}
        <RoleGate permission="connector:write">
          <button
            onClick={() => setAddOpen(true)}
            className="bg-card border-2 border-dashed border-border rounded-xl p-4 flex flex-col items-center justify-center gap-2 min-h-[160px] hover:border-primary/40 hover:bg-primary/5 transition-all group shadow-sm focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
          >
            <div className="w-10 h-10 rounded-full border-2 border-dashed border-border flex items-center justify-center group-hover:border-primary transition-colors bg-muted">
              <PlusCircle className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
            </div>
            <span className="text-[13px] text-muted-foreground group-hover:text-primary transition-colors font-medium">{t.common.addConnector}</span>
          </button>
        </RoleGate>
      </div>
      )}

      {/* Add Connector Slide Panel */}
      <AddConnectorPanel open={addOpen} onClose={() => setAddOpen(false)} />

      {/* Edit Dialog */}
      {editTarget && (
        <EditConnectorDialog
          connector={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ["connectors"] });
            queryClient.invalidateQueries({ queryKey: ["fleet-kpi"] });
            setEditTarget(null);
          }}
        />
      )}

      {/* Delete Confirmation */}
      <DeleteConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        itemName={deleteTarget?.name ?? ""}
        subtitle={deleteTarget?.bpn}
        onConfirm={async () => { if (deleteTarget) await deleteConnector(deleteTarget.id); }}
        queryKeys={[["connectors"], ["fleet-kpi"]]}
        successMessage={t.fleet.deleted}
      />
    </>
  );
}

/* ─── Connector Card ─────────────────────────────────────────── */
function ConnectorCard({ connector: c, onOpen, onEdit, onDelete }: {
  connector: Connector; onOpen: (page?: string) => void;
  onEdit: () => void; onDelete: () => void;
}) {
  const { t } = useI18n();
  // 통계 셀 — 해당 목록으로 딥링크되는 개별 버튼
  const stat = (icon: React.ReactNode, label: string, value: number | string, page: string, ariaLabel: string) => (
    <button
      onClick={() => onOpen(page)}
      aria-label={ariaLabel}
      className="flex items-center gap-1.5 text-muted-foreground rounded px-1 -mx-1 py-0.5 hover:bg-muted hover:text-primary transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
    >
      {icon} {label} <span className="font-semibold text-foreground ml-auto">{value}</span>
    </button>
  );
  return (
    <div className="bg-card rounded-xl p-4 text-left hover:shadow-md transition-all group shadow-sm border border-border hover:border-primary/40">
      {/* Header */}
      <div className="flex items-start justify-between mb-2">
        <button onClick={() => onOpen()} className="flex items-center gap-2 text-left flex-1 min-w-0 rounded focus:outline-none focus-visible:ring-1 focus-visible:ring-primary">
          <span className="text-[15px] font-semibold text-foreground group-hover:text-primary transition-colors truncate">{c.name}</span>
        </button>
        <div className="flex items-center gap-1 flex-shrink-0">
          <StatusPill status={c.status} />
          <RoleGate permission="connector:write">
            <button
              onClick={(e) => { e.stopPropagation(); onEdit(); }}
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-primary transition-colors opacity-60 group-hover:opacity-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
              aria-label={t.fleet.editConnector}
              title={t.fleet.editConnector}
            >
              <Pencil className="w-3 h-3" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-rose-600 transition-colors opacity-60 group-hover:opacity-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-rose-400"
              aria-label={t.fleet.deleteConnector}
              title={t.fleet.deleteConnector}
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </RoleGate>
        </div>
      </div>

      <button onClick={() => onOpen()} className="block w-full text-left rounded focus:outline-none focus-visible:ring-1 focus-visible:ring-primary">
        <div className="text-[12px] text-muted-foreground mb-3">{c.bpn}</div>

        {/* Badges */}
        <div className="flex flex-wrap gap-1.5 mb-4">
          {c.roles?.map((r) => <Badge key={r} variant="sky">{r}</Badge>)}
          <Badge variant="purple">DCP {c.dcp}</Badge>
          {c.aas && <Badge variant="teal">AAS</Badge>}
          <EnvBadge env={c.env} />
        </div>
      </button>

      {/* Stats — 개별 딥링크 버튼 */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12px] pt-3 border-t border-border">
        {stat(<Database className="w-3 h-3 opacity-60" />, t.fleet.assets, c.assets, "assets", `${c.name} — ${t.fleet.assets}`)}
        {stat(<Package className="w-3 h-3 opacity-60" />, t.fleet.offers, c.offers, "contract", `${c.name} — ${t.fleet.offers}`)}
        {stat(<FileText className="w-3 h-3 opacity-60" />, t.fleet.negotiations, c.negs, "negotiation", `${c.name} — ${t.fleet.negotiations}`)}
        {stat(<ArrowRightLeft className="w-3 h-3 opacity-60" />, t.fleet.transfers, c.transfers, "transfer", `${c.name} — ${t.fleet.transfers}`)}
      </div>
    </div>
  );
}

/* ─── Edit Connector Dialog ──────────────────────────────────── */
function EditConnectorDialog({ connector, onClose, onSaved }: {
  connector: Connector; onClose: () => void; onSaved: () => void;
}) {
  const { t } = useI18n();

  // Pre-fill form from connector (note: apiKey is stripped by server, so blank)
  const [name, setName] = useState(connector.name);
  const [managementUrl, setManagementUrl] = useState((connector as any).managementUrl ?? "");
  const [dspEndpoint, setDspEndpoint] = useState((connector as any).dspEndpoint ?? "");
  const [apiKey, setApiKey] = useState("");
  const [role, setRole] = useState(rolesToKey(connector.roles ?? []));
  const [env, setEnv] = useState(connector.env ?? "PROD");
  const [dcpVersion, setDcpVersion] = useState((connector as any).dcpVersion ?? connector.dcp ?? "1.0");
  const [did, setDid] = useState((connector as any).did ?? "");

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"ok" | "fail" | null>(null);

  const handleTest = async () => {
    if (!managementUrl.trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testConnection(managementUrl, apiKey || undefined);
      setTestResult(result.status);
      toast[result.status === "ok" ? "success" : "error"](
        result.status === "ok" ? t.addConnector.testSuccess : t.addConnector.testFail
      );
    } catch { setTestResult("fail"); toast.error(t.addConnector.testFail); }
    finally { setTesting(false); }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const updates: Record<string, unknown> = {
        name: name.trim(),
        managementUrl: managementUrl.trim(), dspEndpoint: dspEndpoint.trim(),
        env, roles: ROLE_MAP[role] ?? ["Provider", "Consumer"],
        dcpVersion, did: did.trim(),
      };
      if (apiKey) updates.apiKey = apiKey;
      await updateConnector(connector.id, updates as any);
      toast.success(t.fleet.updated);
      onSaved();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t.fleet.updateFailed);
    } finally { setSaving(false); }
  };

  const inputClass = inputBase;

  return (
    <SlidePanel open onClose={onClose} className="max-w-xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Pencil className="w-4 h-4 text-blue-500 flex-shrink-0" />
          <span className="text-[15px] font-semibold text-foreground truncate">{t.fleet.editConnector}</span>
        </div>
        <button
          onClick={onClose}
          aria-label={t.common.close}
          className="p-1 rounded hover:bg-muted text-muted-foreground flex-shrink-0 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 min-w-0">
        <FormField label={t.addConnector.connectorName} required>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </FormField>

        <FormField label={t.addConnector.managementUrl} required>
          <div className="flex gap-2">
            <input value={managementUrl} onChange={(e) => { setManagementUrl(e.target.value); setTestResult(null); }} className={`${inputClass} mono flex-1`} />
            {testResult === "ok" && <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0 self-center" />}
            {testResult === "fail" && <XCircle className="w-4 h-4 text-red-500 flex-shrink-0 self-center" />}
          </div>
        </FormField>

        <FormField label={t.addConnector.dspEndpoint} required>
          <input value={dspEndpoint} onChange={(e) => setDspEndpoint(e.target.value)} className={`${inputClass} mono`} />
        </FormField>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <FormField label={t.addConnector.apiKey}>
            <input type="password" value={apiKey} onChange={(e) => { setApiKey(e.target.value); setTestResult(null); }} placeholder={t.fleet.apiKeyUnchanged} className={inputClass} />
          </FormField>
          <FormField label={t.addConnector.role}>
            <select value={role} onChange={(e) => setRole(e.target.value)} className={inputClass}>
              <option value="both">{t.addConnector.roleProviderConsumer}</option>
              <option value="provider">{t.addConnector.roleProvider}</option>
              <option value="consumer">{t.addConnector.roleConsumer}</option>
            </select>
          </FormField>
          <FormField label={t.addConnector.environment}>
            <select value={env} onChange={(e) => setEnv(e.target.value as "PROD" | "STG" | "DEV")} className={inputClass}>
              <option value="PROD">{t.addConnector.envProd}</option>
              <option value="STG">{t.addConnector.envStg}</option>
              <option value="DEV">{t.addConnector.envDev}</option>
            </select>
          </FormField>
          <FormField label={t.addConnector.dcpVersion}>
            <select value={dcpVersion} onChange={(e) => setDcpVersion(e.target.value)} className={inputClass}>
              <option value="1.0">DCP 1.0</option>
              <option value="0.8">DCP 0.8</option>
            </select>
          </FormField>
        </div>

        <FormField label={t.addConnector.did}>
          <input value={did} onChange={(e) => setDid(e.target.value)} placeholder={connector.id} className={`${inputClass} mono`} />
        </FormField>
      </div>

      {/* Footer */}
      <div className="flex justify-end gap-2 px-4 py-3 border-t border-border flex-shrink-0">
        <button onClick={handleTest} disabled={testing || !managementUrl.trim()}
          className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded border border-border hover:bg-muted transition-colors text-muted-foreground disabled:opacity-40 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary">
          {testing && <Loader2 className="w-3 h-3 animate-spin" />}
          {t.addConnector.testConnection}
        </button>
        <button onClick={onClose} className="text-[12px] px-3 py-1.5 rounded border border-border hover:bg-muted transition-colors text-muted-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-primary">
          {t.fleet.cancel}
        </button>
        <button onClick={handleSave} disabled={saving || !name.trim()}
          className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded bg-primary hover:bg-primary/90 text-primary-foreground font-medium transition-colors disabled:opacity-40 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary">
          {saving && <Loader2 className="w-3 h-3 animate-spin" />}
          {t.fleet.save}
        </button>
      </div>
    </SlidePanel>
  );
}
