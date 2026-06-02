// Vault / KMS — secret & key management view
// Reads from /api/platform/vault/* (server-side auth to platform-vault).
// Falls back to demo data when API is unavailable (e.g. dev without platform compose up).
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Vault, Lock, Copy, Eye, EyeOff, Server, Search, X } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/i18n";
import { useConnectorStore } from "@/stores/connectorStore";
import {
  Card, SectionHdr, Badge, AlertBanner, MonoText, CardTitle, inputBase,
  ListCard, ListHeaderRow, ListRow, ListColLabel, ListEmpty, ListError,
} from "@/components/ui-kmx";
import { DataTablePagination, usePagination } from "@/components/DataTablePagination";

const VAULT_COLS = "grid-cols-[2.4fr_0.7fr_1fr_0.9fr_1fr_0.8fr]";
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
  serverManaged?: boolean; // live Vault — value not exposed by API
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

// 마스킹은 실제 시크릿 바이트를 노출하지 않는다 — 길이만 대략 힌트한 점(•) 표시.
function maskValue(v: string) {
  if (!v) return "—";
  return "•".repeat(Math.min(12, Math.max(6, v.length)));
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
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"ALL" | VaultItemType>("ALL");

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
          value: "",
          serverManaged: true,
        })),
      );
    }
  }, [listQuery.data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((it) => {
      if (typeFilter !== "ALL" && it.type !== typeFilter) return false;
      if (q && !it.alias.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, search, typeFilter]);

  const { paginatedData, totalItems, currentPage, pageSize, setCurrentPage, setPageSize } = usePagination(filtered, 10);

  // 필터 변경 시 항상 1페이지부터 보이도록 리셋
  useEffect(() => {
    setCurrentPage(1);
  }, [search, typeFilter, setCurrentPage]);

  const onCopy = (alias: string) => {
    navigator.clipboard.writeText(alias);
    toast.success(t.vault.aliasCopied);
  };

  const TYPE_FILTERS: Array<{ key: "ALL" | VaultItemType; label: string }> = [
    { key: "ALL", label: t.vault.typeAll },
    { key: "key", label: t.vault.typeKey },
    { key: "secret", label: t.vault.typeSecret },
    { key: "certificate", label: t.vault.typeCertificate },
  ];

  return (
    <>
      <SectionHdr
        icon={<Vault className="w-5 h-5 text-primary" />}
        breadcrumb={t.vault.subtitle}
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

      <Card title={
        <CardTitle
          icon={<Server className="w-3.5 h-3.5 text-blue-500" />}
          badge={<Badge variant={backend.sealed ? "red" : "green"}>{backend.sealed ? t.vault.statusSealed : t.vault.statusUnsealed}</Badge>}
        >
          <span className="font-bold">{t.vault.backendInfo}</span>
        </CardTitle>
      }>
        <div className="space-y-3">
          {[
            [t.vault.field.backend, backend.backend, false],
            [t.vault.field.version, backend.version, false],
            [t.vault.field.address, backend.address, false],
            [t.vault.field.namespace, backend.namespace || "—", false],
            [t.vault.field.sealed, backend.sealed ? t.vault.statusSealed : t.vault.statusUnsealed, true],
            [t.vault.field.lastRotation, backend.lastRotation, false],
            [
              t.vault.field.autoRotation,
              backend.autoRotation ? t.vault.field.autoRotationOn : t.vault.field.autoRotationOff,
              true,
            ],
          ].map(([k, v, asTitle]) => (
            <div key={k as string} className="flex items-center justify-between gap-3 py-1.5 border-b border-border last:border-0">
              <span className="text-[12px] text-muted-foreground flex-shrink-0">{k}</span>
              <span className={`text-[12px] text-foreground font-normal text-right break-all ${asTitle ? "" : "mono"}`}>{v}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Search + type filter */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.vault.searchPlaceholder}
            aria-label={t.vault.searchPlaceholder}
            className={`${inputBase} pl-8 pr-8`}
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              aria-label={t.common.clear ?? "Clear"}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] font-medium text-muted-foreground">{t.vault.filterType}</span>
          {TYPE_FILTERS.map((tf) => (
            <button
              key={tf.key}
              onClick={() => setTypeFilter(tf.key)}
              aria-pressed={typeFilter === tf.key}
              className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary ${
                typeFilter === tf.key
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
              }`}
            >
              {tf.label}
            </button>
          ))}
        </div>
      </div>

      {/* Desktop list */}
      <ListCard
        title={t.vault.listTitle}
        actions={<span className="text-[11px] text-muted-foreground">{t.vault.masked}</span>}
        className="hidden md:block"
      >
        {listQuery.isError && items.length === 0 ? (
          <ListError onRetry={() => listQuery.refetch()} fetching={listQuery.isFetching} />
        ) : items.length === 0 ? (
          <ListEmpty icon={<Vault />} message={t.vault.noItems} />
        ) : filtered.length === 0 ? (
          <ListEmpty icon={<Search />} message={t.vault.noSearchResults} />
        ) : (
          <>
            <ListHeaderRow cols={VAULT_COLS}>
              <ListColLabel>{t.vault.col.alias}</ListColLabel>
              <ListColLabel>{t.vault.col.type}</ListColLabel>
              <ListColLabel>{t.vault.col.algorithm}</ListColLabel>
              <ListColLabel className="hidden lg:block">{t.vault.col.created}</ListColLabel>
              <ListColLabel className="hidden xl:block">{t.vault.col.lastUsed}</ListColLabel>
              <ListColLabel>{t.vault.col.expiry}</ListColLabel>
            </ListHeaderRow>
            {paginatedData.map((it) => {
              const isRevealed = revealed === it.alias;
              return (
                <ListRow key={it.alias} cols={VAULT_COLS}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs font-bold text-primary truncate">{it.alias}</span>
                      <button
                        onClick={() => onCopy(it.alias)}
                        title={t.vault.copyAlias}
                        aria-label={t.vault.copyAlias}
                        className="opacity-60 hover:opacity-100 transition-opacity flex-shrink-0 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded"
                      >
                        <Copy className="w-3 h-3 text-muted-foreground" />
                      </button>
                    </div>
                    <div className="mt-1 flex items-center gap-1 min-w-0">
                      {it.serverManaged ? (
                        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/80 truncate">
                          <Lock className="w-3 h-3 flex-shrink-0" />
                          {t.vault.serverManaged}
                        </span>
                      ) : (
                        <>
                          <MonoText className="!text-[11px] !font-normal text-muted-foreground truncate">
                            {isRevealed ? it.value : maskValue(it.value)}
                          </MonoText>
                          <button
                            onClick={() => setRevealed(isRevealed ? null : it.alias)}
                            title={isRevealed ? t.vault.hideValue : t.vault.revealValue}
                            aria-label={isRevealed ? t.vault.hideValue : t.vault.revealValue}
                            className="opacity-60 hover:opacity-100 transition-opacity flex-shrink-0 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded"
                          >
                            {isRevealed ? <EyeOff className="w-3 h-3 text-muted-foreground" /> : <Eye className="w-3 h-3 text-muted-foreground" />}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  <div>{typeBadge(it.type, t)}</div>
                  <div>
                    <span className="text-xs text-foreground">{it.algorithm}</span>
                  </div>
                  <div className="hidden lg:block text-xs text-foreground" title={it.created}>{it.created}</div>
                  <div className="hidden xl:block text-xs text-foreground" title={it.lastUsed}>{it.lastUsed}</div>
                  <div>{expiryBadge(it.expiryDays, t)}</div>
                </ListRow>
              );
            })}
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
          </>
        )}
      </ListCard>

      {/* Mobile stack */}
      <div className="md:hidden flex flex-col gap-3">
        {listQuery.isError && items.length === 0 ? (
          <ListError onRetry={() => listQuery.refetch()} fetching={listQuery.isFetching} />
        ) : items.length === 0 ? (
          <div className="py-6 text-center text-[13px] text-muted-foreground">{t.vault.noItems}</div>
        ) : filtered.length === 0 ? (
          <div className="py-6 text-center text-[13px] text-muted-foreground">{t.vault.noSearchResults}</div>
        ) : (
          paginatedData.map((it) => {
            const isRevealed = revealed === it.alias;
            return (
              <div key={it.alias} className="bg-card rounded-xl p-3 shadow-sm border border-border">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-1 min-w-0">
                    <Vault className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                    <span className="text-xs font-bold text-primary truncate">{it.alias}</span>
                  </div>
                  {typeBadge(it.type, t)}
                </div>
                <div className="text-xs text-foreground mb-1">{it.algorithm}</div>
                <div className="flex items-center gap-1 mb-2">
                  {it.serverManaged ? (
                    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/80 truncate">
                      <Lock className="w-3 h-3 flex-shrink-0" />
                      {t.vault.serverManaged}
                    </span>
                  ) : (
                    <>
                      <MonoText className="text-[11px] text-muted-foreground/80 truncate">
                        {isRevealed ? it.value : maskValue(it.value)}
                      </MonoText>
                      <button
                        onClick={() => setRevealed(isRevealed ? null : it.alias)}
                        title={isRevealed ? t.vault.hideValue : t.vault.revealValue}
                        aria-label={isRevealed ? t.vault.hideValue : t.vault.revealValue}
                        className="opacity-60 hover:opacity-100 transition-opacity flex-shrink-0 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded"
                      >
                        {isRevealed ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                      </button>
                    </>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2">
                  {expiryBadge(it.expiryDays, t)}
                  <span className="text-[11px] text-muted-foreground" title={it.lastUsed}>{it.lastUsed}</span>
                </div>
              </div>
            );
          })
        )}
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
    </>
  );
}
