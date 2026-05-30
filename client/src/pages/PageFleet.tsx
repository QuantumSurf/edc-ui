// Connector Hub — Fleet Overview (spec 4.1)
// Multi-connector home with KPI aggregation, service health, connector grid

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { type Connector } from "@/lib/data";
import { fetchFleetKPI, fetchConnectors, updateConnector, deleteConnector, testConnection } from "@/services";
import { SectionHdr, Badge, StatusPill, EnvBadge, KpiCard, FormField, PrimaryActionButton, inputBase } from "@/components/ui-kmx";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import {
  PlusCircle, Database, Package, FileText, ArrowRightLeft,
  CheckCircle2, XCircle, Shield, Server,
  Pencil, Trash2, Loader2, LayoutGrid,
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
  const [deleting, setDeleting] = useState(false);

  const { data: kpi, isLoading: kpiLoading } = useQuery({
    queryKey: ["fleet-kpi"],
    queryFn: fetchFleetKPI,
    refetchInterval: 60_000,
    retry: 3,
    retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 8_000),
    staleTime: 0,
  });

  const { data: connectors = [], isLoading: connectorsLoading } = useQuery({
    queryKey: ["connectors"],
    queryFn: fetchConnectors,
    refetchInterval: 60_000,
    retry: 3,
    staleTime: 0,
  });

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteConnector(deleteTarget.id);
      queryClient.invalidateQueries({ queryKey: ["connectors"] });
      queryClient.invalidateQueries({ queryKey: ["fleet-kpi"] });
      toast.success(t.fleet.deleted);
      setDeleteTarget(null);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t.fleet.deleteFailed);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        <KpiCard icon={<Server className="w-[18px] h-[18px] text-blue-600" />} iconBg="bg-blue-50" value={kpi?.totalConnectors ?? 0} label={t.fleet.totalConnectors} loading={kpiLoading} />
        <KpiCard icon={<CheckCircle2 className="w-[18px] h-[18px] text-emerald-600" />} iconBg="bg-emerald-50" value={kpi?.up ?? 0} label={t.fleet.healthy} valueColor="text-emerald-600" loading={kpiLoading} />
        <KpiCard icon={<Shield className="w-[18px] h-[18px] text-amber-600" />} iconBg="bg-amber-50" value={kpi?.warn ?? 0} label={t.fleet.warning} sub={t.fleet.needsCheck} valueColor="text-amber-600" loading={kpiLoading} />
        <KpiCard icon={<XCircle className="w-[18px] h-[18px] text-rose-600" />} iconBg="bg-rose-50" value={kpi?.down ?? 0} label={t.fleet.down} valueColor="text-rose-600" loading={kpiLoading} />
        <KpiCard icon={<ArrowRightLeft className="w-[18px] h-[18px] text-sky-600" />} iconBg="bg-sky-50" value={kpi?.totalTransfers ?? 0} label={t.fleet.todayTransfers} sub={t.fleet.assetsRegistered(kpi?.totalAssets ?? 0)} valueColor="text-sky-600" loading={kpiLoading} />
      </div>

      {/* Section Header */}
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

      {/* Connector Grid */}
      {connectorsLoading ? (
        <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-[13px]">{t.common.loading}</span>
        </div>
      ) : (
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
        {(Array.isArray(connectors) ? connectors : []).map((c) => (
          <ConnectorCard
            key={c.id}
            connector={c}
            onClick={() => onSelect(c)}
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
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.fleet.confirmDelete}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget ? t.fleet.confirmDeleteDesc(deleteTarget.name) : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex justify-end gap-2 mt-4">
            <AlertDialogCancel disabled={deleting}>{t.fleet.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {deleting && <Loader2 className="w-3 h-3 animate-spin mr-1" />}
              {t.fleet.delete}
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/* ─── Connector Card ─────────────────────────────────────────── */
function ConnectorCard({ connector: c, onClick, onEdit, onDelete }: {
  connector: Connector; onClick: () => void;
  onEdit: () => void; onDelete: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="bg-card rounded-xl p-4 text-left hover:shadow-md transition-all group shadow-sm border border-border hover:border-primary/40">
      {/* Header */}
      <div className="flex items-start justify-between mb-2">
        <button onClick={onClick} className="flex items-center gap-2 text-left flex-1 min-w-0">
          <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
            c.status === "up" ? "bg-emerald-500" :
            c.status === "warn" ? "bg-amber-500 status-pulse" : "bg-rose-500"
          }`} />
          <span className="text-[15px] font-semibold text-foreground group-hover:text-primary transition-colors truncate">{c.name}</span>
        </button>
        <div className="flex items-center gap-1 flex-shrink-0">
          <StatusPill status={c.status} />
          <RoleGate permission="connector:write">
            <button
              onClick={(e) => { e.stopPropagation(); onEdit(); }}
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-primary transition-colors opacity-60 group-hover:opacity-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
              title={t.fleet.editConnector}
            >
              <Pencil className="w-3 h-3" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-rose-600 transition-colors opacity-60 group-hover:opacity-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-rose-400"
              title={t.fleet.deleteConnector}
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </RoleGate>
        </div>
      </div>

      <button onClick={onClick} className="block w-full text-left">
        <div className="text-[12px] text-muted-foreground mb-3">{c.bpn}</div>

        {/* Badges */}
        <div className="flex flex-wrap gap-1.5 mb-4">
          {c.roles?.map((r) => <Badge key={r} variant="sky">{r}</Badge>)}
          <Badge variant="purple">DCP {c.dcp}</Badge>
          {c.aas && <Badge variant="teal">AAS</Badge>}
          <EnvBadge env={c.env} />
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12px] pt-3 border-t border-border">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Database className="w-3 h-3 opacity-60" /> {t.fleet.assets} <span className="font-semibold text-foreground ml-auto">{c.assets}</span>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Package className="w-3 h-3 opacity-60" /> {t.fleet.offers} <span className="font-semibold text-foreground ml-auto">{c.offers}</span>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <FileText className="w-3 h-3 opacity-60" /> {t.fleet.negotiations} <span className="font-semibold text-foreground ml-auto">{c.negs}</span>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <ArrowRightLeft className="w-3 h-3 opacity-60" /> {t.fleet.transfers} <span className="font-semibold text-foreground ml-auto">{c.transfers}</span>
          </div>
        </div>
      </button>
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
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-[15px]">{t.fleet.editConnector}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
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

          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <button onClick={handleTest} disabled={testing || !managementUrl.trim()}
              className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded border border-border hover:bg-muted transition-colors text-muted-foreground disabled:opacity-40">
              {testing && <Loader2 className="w-3 h-3 animate-spin" />}
              {t.addConnector.testConnection}
            </button>
            <button onClick={onClose} className="text-[12px] px-3 py-1.5 rounded border border-border hover:bg-muted transition-colors text-muted-foreground">
              {t.fleet.cancel}
            </button>
            <button onClick={handleSave} disabled={saving || !name.trim()}
              className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded bg-primary hover:bg-primary/90 text-primary-foreground font-medium transition-colors disabled:opacity-40">
              {saving && <Loader2 className="w-3 h-3 animate-spin" />}
              {t.fleet.save}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
