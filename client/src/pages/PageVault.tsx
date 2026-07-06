// Vault / KMS — secret & key management view
// Reads from /api/platform/vault/* (server-side auth to platform-vault).
// 라이브 데이터만 표시한다. 백엔드 미도달/인증 실패/빈 응답을 데모 데이터로 가리지 않고
// 오류·빈 상태를 그대로 노출해 가짜 시크릿을 진짜처럼 보여주지 않는다.
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Vault,
  Lock,
  Copy,
  Eye,
  EyeOff,
  Server,
  Search,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/i18n";
import {
  Card,
  SectionHdr,
  Badge,
  AlertBanner,
  MonoText,
  CardTitle,
  inputBase,
  ListCard,
  ListHeaderRow,
  ListRow,
  ListColLabel,
  ListEmpty,
  ListError,
  RefreshButton,
} from "@/components/ui-kmx";
import {
  DataTablePagination,
  usePagination,
} from "@/components/DataTablePagination";

// 반응형: lg 미만은 중요 컬럼(별칭·유형·만료)만 유동폭으로 표시하고
// 부차 컬럼(알고리즘·생성일·마지막 사용)은 hidden lg:block 으로 숨긴다. lg+ 는 전체 6컬럼.
// (과거 created=lg / lastUsed=xl 로 단계가 갈려 lg 미만에 빈 트랙이 남던 결함 → lg 단일 브레이크포인트로 통일)
const VAULT_COLS =
  "grid-cols-[minmax(140px,1fr)_90px_110px] lg:grid-cols-[2.4fr_0.7fr_1fr_0.9fr_1fr_0.8fr]";
import {
  fetchVaultStatus,
  fetchVaultList,
  type VaultStatusResp as VaultStatus,
  type VaultListResp,
} from "@/services/api";

// 별칭 문자열로 유형만 분류 — 필터 UX 용도. (만료/생성/알고리즘은 추측하지 않는다)
function inferType(alias: string): VaultItemType {
  if (alias.includes("cert")) return "certificate";
  if (alias.includes("key")) return "key";
  return "secret";
}

type VaultItemType = "secret" | "key" | "certificate";

interface VaultItem {
  alias: string;
  type: VaultItemType;
  algorithm: string;
  created: string;
  lastUsed: string;
  expiryDays: number | null; // null = no expiry / unknown
  value: string; // shown masked
  serverManaged?: boolean; // live Vault — value not exposed by API
}

interface VaultBackendInfo {
  backend: string;
  version: string;
  address: string;
  /** Vault status API 는 제공하지 않음 — 라이브로 채울 수 없으면 "—" */
  lastRotation: string;
  /** Vault status API 는 제공하지 않음 — 알 수 없으면 null */
  autoRotation: boolean | null;
  sealed: boolean;
}

// status 가 라이브로 확인되기 전의 초기/미확인 백엔드 상태.
// 하드코딩 주소·버전·회전시각을 사실처럼 노출하지 않도록 모두 "—"/null 로 시작한다.
const UNKNOWN_BACKEND: VaultBackendInfo = {
  backend: "—",
  version: "—",
  address: "—",
  lastRotation: "—",
  autoRotation: null,
  sealed: false,
};

// 마스킹은 실제 시크릿 바이트를 노출하지 않는다 — 길이만 대략 힌트한 점(•) 표시.
function maskValue(v: string) {
  if (!v) return "—";
  return "•".repeat(Math.min(12, Math.max(6, v.length)));
}

function expiryBadge(days: number | null, t: ReturnType<typeof useI18n>["t"]) {
  if (days === null) return <Badge variant="gray">—</Badge>;
  if (days <= 0) return <Badge variant="red">{t.vault.expired}</Badge>;
  if (days <= 7) return <Badge variant="red">{t.vault.daysLeft(days)}</Badge>;
  if (days <= 30)
    return <Badge variant="amber">{t.vault.daysLeft(days)}</Badge>;
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
  const { t, locale } = useI18n();

  // 전역 Vault 페이지는 특정 커넥터에 종속되지 않는다.
  // (직전 선택 커넥터의 namespace 를 표시하던 stale 격리 표시 결함 제거)
  const [backend, setBackend] = useState<VaultBackendInfo>(UNKNOWN_BACKEND);
  const [items, setItems] = useState<VaultItem[]>([]);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"ALL" | VaultItemType>("ALL");

  // ── Live data from /api/platform/vault ──
  const statusQuery = useQuery<VaultStatus>({
    queryKey: ["platform-vault", "status"],
    queryFn: fetchVaultStatus,
    retry: false,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
  const listQuery = useQuery<VaultListResp>({
    queryKey: ["platform-vault", "list"],
    queryFn: fetchVaultList,
    retry: false,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  // status 가 실제로 라이브 응답으로 확인됐는지 — 봉인 배지/배너의 신뢰성 판정 기준.
  const statusLive = statusQuery.isSuccess && !!statusQuery.data;

  useEffect(() => {
    if (statusQuery.data) {
      // lastRotation·autoRotation 은 status API 가 제공하지 않으므로 채우지 않는다(추측 금지).
      setBackend({
        backend: statusQuery.data.type || "HashiCorp Vault",
        version: statusQuery.data.version,
        address: statusQuery.data.url,
        sealed: statusQuery.data.sealed,
        lastRotation: "—",
        autoRotation: null,
      });
    } else if (statusQuery.isError) {
      // 라이브 실패 — 하드코딩 백엔드 정보를 사실처럼 남기지 않고 미확인 상태로 되돌린다.
      setBackend(UNKNOWN_BACKEND);
    }
  }, [statusQuery.data, statusQuery.isError]);

  useEffect(() => {
    // 0건 응답도 빈 목록으로 반영되도록 truthy length 게이트 대신 data 존재로 판정.
    if (listQuery.data) {
      setItems(
        (listQuery.data.aliases ?? []).map(alias => ({
          alias,
          type: inferType(alias),
          // /list 는 알고리즘·생성일·만료 정보를 주지 않는다 — 추측해서 위조 배지를 만들지 않는다.
          algorithm: "—",
          created: "—",
          lastUsed: "—",
          expiryDays: null,
          value: "",
          serverManaged: true,
        }))
      );
    } else if (listQuery.isError) {
      // 라이브 실패 — 데모 잔존분이 filtered/페이지네이션으로 새지 않도록 비운다.
      setItems([]);
    }
  }, [listQuery.data, listQuery.isError]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter(it => {
      if (typeFilter !== "ALL" && it.type !== typeFilter) return false;
      if (q && !it.alias.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, search, typeFilter]);

  const {
    paginatedData,
    totalItems,
    currentPage,
    pageSize,
    setCurrentPage,
    setPageSize,
  } = usePagination(filtered, 10);

  // 필터 변경 시 항상 1페이지부터 보이도록 리셋
  useEffect(() => {
    setCurrentPage(1);
  }, [search, typeFilter, setCurrentPage]);

  const onCopy = (alias: string) => {
    navigator.clipboard.writeText(alias).then(
      () => toast.success(t.vault.aliasCopied),
      () => toast.error(t.common.copyFailed)
    );
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
        subtitle={t.pageSubtitles.vault}
        action={
          <RefreshButton
            onRefresh={() => listQuery.refetch()}
            busy={listQuery.isFetching}
            label={t.common.refresh}
          />
        }
      >
        {t.vault.title}
      </SectionHdr>

      {/* 봉인 경보는 status 가 라이브로 확인됐을 때만 의미가 있다(데모 sealed:false 로 절대 안 뜨던 결함 제거) */}
      {statusLive && backend.sealed && (
        <AlertBanner variant="danger">
          <div className="flex flex-col gap-0.5">
            <span className="font-semibold">{t.vault.sealAlertTitle}</span>
            <span className="text-[11px] opacity-90">
              {t.vault.sealAlertDesc}
            </span>
          </div>
        </AlertBanner>
      )}

      {/* status 미도달 — 봉인 여부조차 확인 불가함을 명확히 알린다 */}
      {statusQuery.isError && (
        <AlertBanner variant="warn">
          <div className="flex flex-col gap-0.5">
            <span className="font-semibold">
              {locale === "ko"
                ? "Vault 상태를 확인할 수 없습니다"
                : "Vault status unavailable"}
            </span>
            <span className="text-[11px] opacity-90">
              {locale === "ko"
                ? "Vault 백엔드에 도달하지 못했습니다. 봉인 여부·주소·버전을 확인할 수 없습니다."
                : "Could not reach the Vault backend. Seal state, address and version cannot be verified."}
            </span>
          </div>
        </AlertBanner>
      )}

      <Card
        title={
          <CardTitle
            icon={<Server className="w-3.5 h-3.5 text-blue-500" />}
            badge={
              // status 미확인 시 봉인 배지를 'Unknown'(회색)으로 — Unsealed 로 위장하지 않는다
              <Badge
                variant={!statusLive ? "gray" : backend.sealed ? "red" : "green"}
              >
                {!statusLive
                  ? t.vault.statusUnknown
                  : backend.sealed
                    ? t.vault.statusSealed
                    : t.vault.statusUnsealed}
              </Badge>
            }
          >
            <span className="font-bold">{t.vault.backendInfo}</span>
          </CardTitle>
        }
      >
        <div className="space-y-3">
          {[
            [t.vault.field.backend, backend.backend, false],
            [t.vault.field.version, backend.version, false],
            [t.vault.field.address, backend.address, false],
            [
              t.vault.field.sealed,
              !statusLive
                ? t.vault.statusUnknown
                : backend.sealed
                  ? t.vault.statusSealed
                  : t.vault.statusUnsealed,
              true,
            ],
            [t.vault.field.lastRotation, backend.lastRotation, false],
            [
              t.vault.field.autoRotation,
              // status API 가 제공하지 않는 값 — 추측(ON) 대신 미확인 시 "—"
              backend.autoRotation == null
                ? "—"
                : backend.autoRotation
                  ? t.vault.field.autoRotationOn
                  : t.vault.field.autoRotationOff,
              true,
            ],
          ].map(([k, v, asTitle]) => (
            <div
              key={k as string}
              className="flex items-center justify-between gap-3 py-1.5 border-b border-border last:border-0"
            >
              <span className="text-[12px] text-muted-foreground flex-shrink-0">
                {k}
              </span>
              <span
                className={`text-[12px] text-foreground font-normal text-right break-all ${asTitle ? "" : "mono"}`}
              >
                {v}
              </span>
            </div>
          ))}
        </div>
      </Card>

      {/* Search + type filter — 검색+필터를 한 카드에 그룹화 (pcf 패턴) */}
      <div className="flex items-center gap-3 flex-wrap bg-card border border-border rounded-xl px-4 py-3 shadow-sm">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t.vault.searchPlaceholder}
            aria-label={t.vault.searchPlaceholder}
            className={`${inputBase} pl-8 pr-8 !bg-background`}
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
          <span className="text-[11px] font-medium text-muted-foreground">
            {t.vault.filterType}
          </span>
          {TYPE_FILTERS.map(tf => (
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
        responsive
        actions={
          <span className="text-[11px] text-muted-foreground">
            {t.vault.masked}
          </span>
        }
        className="hidden md:block"
      >
        {/* 라이브 실패는 데모 length 에 가리지 않고 항상 에러로 표시 */}
        {listQuery.isError ? (
          <ListError
            onRetry={() => listQuery.refetch()}
            fetching={listQuery.isFetching}
          />
        ) : listQuery.isLoading ? (
          <ListEmpty icon={<Vault />} message={t.common.loading} />
        ) : items.length === 0 ? (
          <ListEmpty icon={<Vault />} message={t.vault.noItems} />
        ) : filtered.length === 0 ? (
          <ListEmpty icon={<Search />} message={t.vault.noSearchResults} />
        ) : (
          <>
            <ListHeaderRow cols={VAULT_COLS}>
              <ListColLabel>{t.vault.col.alias}</ListColLabel>
              <ListColLabel>{t.vault.col.type}</ListColLabel>
              <ListColLabel className="hidden lg:block">
                {t.vault.col.algorithm}
              </ListColLabel>
              <ListColLabel className="hidden lg:block">
                {t.vault.col.created}
              </ListColLabel>
              <ListColLabel className="hidden lg:block">
                {t.vault.col.lastUsed}
              </ListColLabel>
              <ListColLabel>{t.vault.col.expiry}</ListColLabel>
            </ListHeaderRow>
            {paginatedData.map(it => {
              const isRevealed = revealed === it.alias;
              return (
                <ListRow key={it.alias} cols={VAULT_COLS}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs font-bold text-primary truncate">
                        {it.alias}
                      </span>
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
                            onClick={() =>
                              setRevealed(isRevealed ? null : it.alias)
                            }
                            title={
                              isRevealed
                                ? t.vault.hideValue
                                : t.vault.revealValue
                            }
                            aria-label={
                              isRevealed
                                ? t.vault.hideValue
                                : t.vault.revealValue
                            }
                            className="opacity-60 hover:opacity-100 transition-opacity flex-shrink-0 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded"
                          >
                            {isRevealed ? (
                              <EyeOff className="w-3 h-3 text-muted-foreground" />
                            ) : (
                              <Eye className="w-3 h-3 text-muted-foreground" />
                            )}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  <div>{typeBadge(it.type, t)}</div>
                  <div className="hidden lg:block">
                    <span className="text-xs text-foreground">
                      {it.algorithm}
                    </span>
                  </div>
                  <div
                    className="hidden lg:block text-xs text-foreground"
                    title={it.created}
                  >
                    {it.created}
                  </div>
                  <div
                    className="hidden lg:block text-xs text-foreground"
                    title={it.lastUsed}
                  >
                    {it.lastUsed}
                  </div>
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
        {listQuery.isError ? (
          <ListError
            onRetry={() => listQuery.refetch()}
            fetching={listQuery.isFetching}
          />
        ) : listQuery.isLoading ? (
          <div className="py-6 text-center text-[13px] text-muted-foreground">
            {t.common.loading}
          </div>
        ) : items.length === 0 ? (
          <div className="py-6 text-center text-[13px] text-muted-foreground">
            {t.vault.noItems}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-6 text-center text-[13px] text-muted-foreground">
            {t.vault.noSearchResults}
          </div>
        ) : (
          paginatedData.map(it => {
            const isRevealed = revealed === it.alias;
            return (
              <div
                key={it.alias}
                className="bg-card rounded-xl p-3 shadow-sm border border-border"
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-1 min-w-0">
                    <Vault className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                    <span className="text-xs font-bold text-primary truncate">
                      {it.alias}
                    </span>
                  </div>
                  {typeBadge(it.type, t)}
                </div>
                <div className="text-xs text-foreground mb-1">
                  {it.algorithm}
                </div>
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
                        onClick={() =>
                          setRevealed(isRevealed ? null : it.alias)
                        }
                        title={
                          isRevealed ? t.vault.hideValue : t.vault.revealValue
                        }
                        aria-label={
                          isRevealed ? t.vault.hideValue : t.vault.revealValue
                        }
                        className="opacity-60 hover:opacity-100 transition-opacity flex-shrink-0 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded"
                      >
                        {isRevealed ? (
                          <EyeOff className="w-3 h-3" />
                        ) : (
                          <Eye className="w-3 h-3" />
                        )}
                      </button>
                    </>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2">
                  {expiryBadge(it.expiryDays, t)}
                  <span
                    className="text-[11px] text-muted-foreground"
                    title={it.lastUsed}
                  >
                    {it.lastUsed}
                  </span>
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
