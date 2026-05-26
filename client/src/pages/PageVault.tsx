// Vault / KMS — secret & key management view
// Reads from /api/platform/vault/* (server-side auth to platform-vault).
// Falls back to demo data when API is unavailable (e.g. dev without platform compose up).
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Vault, Lock, Unlock, KeyRound, AlertTriangle, Copy, RefreshCw, Trash2, Eye, Server } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/i18n";
import { useConnectorStore } from "@/stores/connectorStore";
import {
  Card, KpiCard, SectionHdr, Badge, AlertBanner, MonoText, DataSourceBadge, CardTitle,
  ListCard, ListHeaderRow, ListRow, ListColLabel, ListEmpty,
} from "@/components/ui-kmx";

const VAULT_COLS = "grid-cols-[2.4fr_0.7fr_1fr_0.9fr_1fr_0.8fr_64px]";
import {
  fetchVaultStatus, fetchVaultList,
  type VaultStatusResp as VaultStatus, type VaultListResp,
} from "@/services/api";

function inferType(alias: string): VaultItemType {
  if (alias.includes("cert")) return "certificate";
  if (alias.includes("key")) return "key";
  return "secret";
}

function inferAlgorithm(alias: string): string {
  if (alias.includes("private-key")) return "Ed25519";
  if (alias.includes("public-key")) return "Ed25519";
  if (alias.includes("aes")) return "AES-256-GCM";
  if (alias.includes("cert")) return "X.509";
  return "Bearer";
}

type VaultItemType = "secret" | "key" | "certificate";

interface VaultItem {
  alias: string;
  type: VaultItemType;
  algorithm: string;
  created: string;
  lastUsed: string;
  expiryDays: number | null; // null = no expiry
  value: string; // shown masked
}

interface VaultBackendInfo {
  backend: string;
  version: string;
  address: string;
  /** Vault Enterprise namespace — 단일 공유 클러스터에서 커넥터별 격리에 사용 */
  namespace: string;
  /** 모든 커넥터가 같은 HA 클러스터를 공유함을 나타내는 안내 문구 */
  shared: boolean;
  sealed: boolean;
  lastRotation: string;
  autoRotation: boolean;
}

function maskValue(v: string) {
  if (!v || v.length <= 12) return v || "—";
  return v.slice(0, 10) + "…";
}

function makeDemoData(connectorId: string): { backend: VaultBackendInfo; items: VaultItem[] } {
  const isProd = connectorId.toLowerCase().includes("prod");
  const isCons = connectorId.toLowerCase().includes("cons");
  // 모든 커넥터가 같은 HA 클러스터(vault.kmx.io)를 공유, namespace로 격리.
  const namespace = isProd ? "kmx/prod" : isCons ? "kmx/cons" : "kmx/dev";
  const backend: VaultBackendInfo = {
    backend: "HashiCorp Vault (Shared HA)",
    version: "1.15.4",
    address: "https://vault.kmx.io:8200",
    namespace,
    shared: true,
    sealed: false,
    lastRotation: "2026-04-28 02:15 KST",
    autoRotation: true,
  };
  const items: VaultItem[] = [
    {
      alias: "edc:key:asset-encryption",
      type: "key",
      algorithm: "AES-256-GCM",
      created: "2025-11-14",
      lastUsed: "2026-05-07 09:42",
      expiryDays: 18,
      value: "vault-secret-key-aes256-encrypted-base64-payload",
    },
    {
      alias: "edc:key:dsp-signing",
      type: "key",
      algorithm: "Ed25519",
      created: "2026-02-01",
      lastUsed: "2026-05-07 10:11",
      expiryDays: 270,
      value: "MC4CAQAwBQYDK2VwBCIEIH7nGq...",
    },
    {
      alias: "edc:secret:provider-api-token",
      type: "secret",
      algorithm: "Bearer",
      created: "2026-01-22",
      lastUsed: "2026-05-06 23:04",
      expiryDays: 4,
      value: "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.demo.payload.signature",
    },
    {
      alias: "edc:cert:dsp-mtls",
      type: "certificate",
      algorithm: "X.509 / RSA-2048",
      created: "2025-09-01",
      lastUsed: "2026-05-07 09:55",
      expiryDays: 121,
      value: "-----BEGIN CERTIFICATE-----MIIDXTCCAk...",
    },
    {
      alias: "edc:secret:onboarding-token",
      type: "secret",
      algorithm: "Bearer",
      created: "2026-04-10",
      lastUsed: "—",
      expiryDays: null,
      value: "ott_2j3k4lmn5opqr6stuv7wxyz",
    },
  ];
  return { backend, items };
}

function expiryBadge(days: number | null, t: ReturnType<typeof useI18n>["t"]) {
  if (days === null) return <Badge variant="gray">—</Badge>;
  if (days <= 0) return <Badge variant="red">{t.vault.expired}</Badge>;
  if (days <= 7) return <Badge variant="red">{t.vault.daysLeft(days)}</Badge>;
  if (days <= 30) return <Badge variant="amber">{t.vault.daysLeft(days)}</Badge>;
  return <Badge variant="green">{t.vault.daysLeft(days)}</Badge>;
}

function typeBadge(type: VaultItemType, t: ReturnType<typeof useI18n>["t"]) {
  const map = {
    key: { label: t.vault.typeKey, variant: "blue" as const },
    secret: { label: t.vault.typeSecret, variant: "purple" as const },
    certificate: { label: t.vault.typeCertificate, variant: "teal" as const },
  };
  const m = map[type];
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

export default function PageVault() {
  const { t } = useI18n();
  const connector = useConnectorStore((s) => s.connector);

  const initial = useMemo(
    () => makeDemoData(connector?.id ?? "demo"),
    [connector?.id],
  );
  const [backend, setBackend] = useState<VaultBackendInfo>(initial.backend);
  const [items, setItems] = useState<VaultItem[]>(initial.items);
  const [revealed, setRevealed] = useState<string | null>(null);

  // ── Live data from /api/platform/vault (graceful fallback to demo) ──
  const statusQuery = useQuery<VaultStatus>({
    queryKey: ["platform-vault", "status"],
    queryFn: fetchVaultStatus,
    retry: false,
    refetchInterval: 30_000,
  });
  const listQuery = useQuery<VaultListResp>({
    queryKey: ["platform-vault", "list"],
    queryFn: fetchVaultList,
    retry: false,
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (statusQuery.data) {
      setBackend((prev) => ({
        ...prev,
        backend: "HashiCorp Vault (Shared HA)",
        version: statusQuery.data.version,
        address: statusQuery.data.url,
        sealed: statusQuery.data.sealed,
        shared: true,
      }));
    }
  }, [statusQuery.data]);

  useEffect(() => {
    if (listQuery.data?.aliases?.length) {
      const today = new Date().toISOString().slice(0, 10);
      setItems(
        listQuery.data.aliases.map((alias) => ({
          alias,
          type: inferType(alias),
          algorithm: inferAlgorithm(alias),
          created: today,
          lastUsed: "—",
          expiryDays: alias.includes("aes") ? 365 : null,
          value: "(server-managed — values not exposed)",
        })),
      );
    }
  }, [listQuery.data]);

  const isLive = !!statusQuery.data || !!listQuery.data?.aliases?.length;

  const expiringCount = items.filter((i) => i.expiryDays !== null && i.expiryDays <= 30 && i.expiryDays > 0).length;
  const secretCount = items.filter((i) => i.type !== "key").length;
  const keyCount = items.filter((i) => i.type === "key").length;

  const onRotate = (alias: string) => {
    if (!confirm(t.vault.rotateConfirm)) return;
    setItems((prev) =>
      prev.map((i) =>
        i.alias === alias
          ? { ...i, created: new Date().toISOString().slice(0, 10), expiryDays: 365, lastUsed: "—" }
          : i,
      ),
    );
    setBackend((b) => ({ ...b, lastRotation: new Date().toLocaleString() }));
    toast.success(t.vault.rotateSuccess(alias));
  };

  const onDelete = (alias: string) => {
    if (!confirm(t.vault.deleteConfirm)) return;
    setItems((prev) => prev.filter((i) => i.alias !== alias));
    toast.success(t.vault.deleteSuccess(alias));
  };

  const onCopy = (alias: string) => {
    navigator.clipboard.writeText(alias);
    toast.success(t.vault.aliasCopied);
  };

  return (
    <>
      <SectionHdr
        icon={<Vault className="w-5 h-5 text-primary" />}
        breadcrumb={t.vault.subtitle}
        action={<DataSourceBadge mode={isLive ? "live" : "demo"} />}
      >
        {t.vault.title}
      </SectionHdr>

      {backend.sealed && (
        <AlertBanner variant="danger">
          <div className="flex flex-col gap-0.5">
            <span className="font-semibold">{t.vault.sealAlertTitle}</span>
            <span className="text-[11px] opacity-90">{t.vault.sealAlertDesc}</span>
          </div>
        </AlertBanner>
      )}

      <Card title={<CardTitle icon={<Server className="w-4 h-4 text-primary" />}>{t.vault.backendInfo}</CardTitle>}>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-[12px]">
          {[
            [t.vault.field.backend, backend.backend],
            [t.vault.field.version, backend.version],
            [t.vault.field.address, backend.address],
            [t.vault.field.namespace, backend.namespace || "—"],
            [t.vault.field.sealed, backend.sealed ? t.vault.statusSealed : t.vault.statusUnsealed],
            [t.vault.field.lastRotation, backend.lastRotation],
            [
              t.vault.field.autoRotation,
              backend.autoRotation ? t.vault.field.autoRotationOn : t.vault.field.autoRotationOff,
            ],
          ].map(([k, v]) => (
            <div key={k}>
              <div className="font-display text-[13px] font-semibold text-foreground/80 mb-1">{k}</div>
              <div className="mono text-[12px] font-normal text-foreground/80 break-all">{v}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* Desktop list */}
      <ListCard
        title={t.vault.listTitle}        actions={<span className="text-[11px] text-muted-foreground">{t.vault.masked}</span>}
        className="hidden md:block"
      >
        {items.length === 0 ? (
          <ListEmpty icon={<Vault />} message={t.vault.noItems} />
        ) : (
          <>
            <ListHeaderRow cols={VAULT_COLS}>
              <ListColLabel>{t.vault.col.alias}</ListColLabel>
              <ListColLabel>{t.vault.col.type}</ListColLabel>
              <ListColLabel>{t.vault.col.algorithm}</ListColLabel>
              <ListColLabel className="hidden lg:block">{t.vault.col.created}</ListColLabel>
              <ListColLabel className="hidden xl:block">{t.vault.col.lastUsed}</ListColLabel>
              <ListColLabel>{t.vault.col.expiry}</ListColLabel>
              <ListColLabel className="text-right">{t.vault.col.actions}</ListColLabel>
            </ListHeaderRow>
            {items.map((it) => {
              const isRevealed = revealed === it.alias;
              return (
                <ListRow key={it.alias} cols={VAULT_COLS}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <MonoText className="!text-[12px] !font-normal truncate">{it.alias}</MonoText>
                      <button
                        onClick={() => onCopy(it.alias)}
                        title={t.vault.copyAlias}
                        className="opacity-50 hover:opacity-100 transition-opacity flex-shrink-0"
                      >
                        <Copy className="w-3 h-3 text-muted-foreground" />
                      </button>
                    </div>
                    <div className="mt-1 flex items-center gap-1 min-w-0">
                      <MonoText className="!text-[11px] !font-normal text-muted-foreground truncate">
                        {isRevealed ? it.value : maskValue(it.value)}
                      </MonoText>
                      <button
                        onClick={() => setRevealed(isRevealed ? null : it.alias)}
                        title={t.vault.revealValue}
                        className="opacity-50 hover:opacity-100 transition-opacity flex-shrink-0"
                      >
                        <Eye className="w-3 h-3 text-muted-foreground" />
                      </button>
                    </div>
                  </div>
                  <div>{typeBadge(it.type, t)}</div>
                  <div>
                    <MonoText className="!text-[12px] !font-normal">{it.algorithm}</MonoText>
                  </div>
                  <div className="hidden lg:block text-[12px] font-normal text-muted-foreground">{it.created}</div>
                  <div className="hidden xl:block text-[12px] font-normal text-muted-foreground">{it.lastUsed}</div>
                  <div>{expiryBadge(it.expiryDays, t)}</div>
                  <div className="flex items-center gap-1 justify-end">
                    {it.type === "key" && (
                      <button
                        onClick={() => onRotate(it.alias)}
                        title={t.vault.rotate}
                        className="p-1 rounded hover:bg-blue-50 text-blue-600 transition-colors"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      onClick={() => onDelete(it.alias)}
                      title={t.common.delete}
                      className="p-1 rounded hover:bg-rose-50 text-rose-500 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </ListRow>
              );
            })}
          </>
        )}
      </ListCard>

      {/* Mobile stack */}
      <div className="md:hidden flex flex-col gap-3">
        {items.length === 0 ? (
          <div className="py-6 text-center text-[13px] text-muted-foreground">{t.vault.noItems}</div>
        ) : (
          items.map((it) => {
            const isRevealed = revealed === it.alias;
            return (
              <div key={it.alias} className="bg-card rounded-xl p-3 shadow-sm border border-border">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-1 min-w-0">
                    <Vault className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                    <MonoText className="text-[12px] font-normal truncate">{it.alias}</MonoText>
                  </div>
                  {typeBadge(it.type, t)}
                </div>
                <div className="text-[11px] text-muted-foreground mb-1">{it.algorithm}</div>
                <div className="flex items-center gap-1 mb-2">
                  <MonoText className="text-[11px] text-muted-foreground/80 truncate">
                    {isRevealed ? it.value : maskValue(it.value)}
                  </MonoText>
                  <button onClick={() => setRevealed(isRevealed ? null : it.alias)} className="opacity-60">
                    <Eye className="w-3 h-3" />
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  {expiryBadge(it.expiryDays, t)}
                  <div className="flex items-center gap-1">
                    {it.type === "key" && (
                      <button
                        onClick={() => onRotate(it.alias)}
                        className="text-[11px] text-blue-600 flex items-center gap-1 px-2 py-1 rounded hover:bg-blue-50"
                      >
                        <RefreshCw className="w-3 h-3" /> {t.vault.rotate}
                      </button>
                    )}
                    <button
                      onClick={() => onDelete(it.alias)}
                      className="text-[11px] text-rose-500 flex items-center gap-1 px-2 py-1 rounded hover:bg-rose-50"
                    >
                      <Trash2 className="w-3 h-3" /> {t.common.delete}
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
