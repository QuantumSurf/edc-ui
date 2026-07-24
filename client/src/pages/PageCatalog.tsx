// Connector Hub — Catalog Browser (spec 4.5)
// DSP Endpoint input → catalog query → negotiation start flow

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { fetchCatalog, startNegotiation, fetchConnectors } from "@/services";
import { type CatalogOffer } from "@/lib/data";
import { useConnectorStore } from "@/stores/connectorStore";
import {
  Card,
  Badge,
  SectionHdr,
  CardTitle,
  FormField,
  inputBase,
  PrimaryActionButton,
  ListError,
  ListEmpty,
} from "@/components/ui-kmx";
import { DataTablePagination } from "@/components/DataTablePagination";
import { usePagination } from "@/lib/usePagination";
import {
  getRecent,
  addRecent,
  removeRecent,
  RECENT_KEY,
  type RecentCatalogEntry,
} from "@/lib/recentCatalog";
import {
  Search,
  Globe,
  ArrowRight,
  Loader2,
  Building2,
  Info,
  Package,
  X,
  Boxes,
} from "lucide-react";
import { toast } from "sonner";
import { RoleGate } from "@/components/RoleGate";
import { cn } from "@/lib/utils";
import { HistoryDatalist } from "@/components/FieldHistory";
import { useFieldHistory, fhId } from "@/lib/fieldHistory";

interface PageCatalogProps {
  onNav: (path: string) => void;
}

export default function PageCatalog({ onNav }: PageCatalogProps) {
  const { t, locale } = useI18n();
  const connector = useConnectorStore(s => s.connector);
  const connectorId = connector?.id;
  const [url, setUrl] = useState("");
  const [counterPartyId, setCounterPartyId] = useState("");
  const [offers, setOffers] = useState<CatalogOffer[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState("");
  // 협상 진행 중인 오퍼 — 해당 행만 비활성+스피너로 표시(전체 행 동시 비활성화 방지).
  const [pendingOfferId, setPendingOfferId] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentCatalogEntry[]>(() => getRecent());
  // 서버 입력 이력 기반 자동완성(개별 필드) — localStorage recent(전체 쌍)와 병행.
  const { suggestions, record } = useFieldHistory([
    "catalog.dspEndpoint",
    "catalog.counterPartyId",
  ]);

  // cross-tab 동기화 — 다른 탭에서 최근조회가 바뀌면(storage 이벤트는 타 탭 변경만 도착) 재동기화.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === RECENT_KEY) setRecent(getRecent());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // 빠른 선택용: 등록된 커넥터(현재 선택 커넥터 제외, dspEndpoint 보유). dsp·did 자동 채움.
  const { data: connectors = [] } = useQuery({
    queryKey: ["connectors"],
    queryFn: fetchConnectors,
  });
  const peers = connectors.filter(c => c.id !== connectorId && !!c.dspEndpoint);

  const handlePick = (value: string) => {
    setPick(value);
    // recent 항목은 아래 버튼 목록에서 직접 처리하므로 select 는 conn: 만 다룬다.
    if (value.startsWith("conn:")) {
      const c = peers.find(p => p.id === value.slice(5));
      if (c) {
        setUrl(c.dspEndpoint ?? "");
        // did 우선, 없으면 bpn 폴백. 둘 다 비면 빈 값 전송을 막고 직접 입력을 유도.
        const candidate = (c.did || c.bpn || "").trim();
        if (!candidate) {
          toast.warning(
            locale === "ko"
              ? "이 커넥터에는 사용할 수 있는 DID/BPN 이 없어 직접 입력해야 합니다."
              : "This connector has no usable DID/BPN — please enter it manually."
          );
          return;
        }
        // did: 도 표준 BPNL 도 아닌 값은 정규화 없이 그대로 전송되어 audience 불일치(opaque 401) 가능.
        const normalizable =
          /^did:/i.test(candidate) || /^BPNL[0-9A-Z]+$/i.test(candidate);
        if (!normalizable) {
          toast.warning(
            locale === "ko"
              ? "표준 DID/BPN 형식이 아니어서 정규화 없이 그대로 전송됩니다. 조회가 실패하면 값을 확인하세요."
              : "Not a standard DID/BPN — it will be sent as-is without normalization. Verify the value if the query fails."
          );
        }
        setCounterPartyId(candidate);
      }
    }
  };

  const handleQuery = async () => {
    if (!url.trim()) {
      toast.error(t.catalog.dspRequired);
      return;
    }
    if (!counterPartyId.trim()) {
      toast.error(t.catalog.bpnRequired);
      return;
    }
    // 형식 보강: DSP 엔드포인트는 http(s):// URL 이어야 한다(빈값 외 형식 오류 사전 차단).
    if (!/^https?:\/\//i.test(url.trim())) {
      toast.error(
        locale === "ko"
          ? "DSP 엔드포인트는 http:// 또는 https:// 로 시작해야 합니다."
          : "DSP endpoint must start with http:// or https://."
      );
      return;
    }
    if (!connectorId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchCatalog(url, counterPartyId, connectorId);
      setOffers(result);
      setLoaded(true);
      setRecent(addRecent({ url, counterPartyId }));
      // 조회 성공 시 입력값을 서버 이력에 기록(다음 작성 시 자동완성 제안).
      record([
        { fieldKey: "catalog.dspEndpoint", value: url },
        { fieldKey: "catalog.counterPartyId", value: counterPartyId },
      ]);
    } catch (err: unknown) {
      // EDC가 돌려준 actionable 에러(4xx 검증·SSRF 거부, 5xx 자격증명/구성 실패 등)는
      // 실제 원인 메시지를 노출, 그 외(전송/내부 마스킹)는 로컬라이즈된 안내 문구를 사용.
      const e = err as {
        response?: {
          status?: number;
          data?: { error?: string; actionable?: boolean };
        };
      };
      const status = e?.response?.status;
      const data = e?.response?.data;
      const showServerMsg =
        (data?.actionable || (status != null && status < 500)) &&
        typeof data?.error === "string";
      const msg = showServerMsg
        ? (data!.error as string)
        : t.catalog.queryFailed;
      toast.error(msg);
      setError(msg);
      setOffers([]);
      setLoaded(true);
    } finally {
      setLoading(false);
    }
  };

  const negMutation = useMutation({
    mutationFn: (offer: CatalogOffer) =>
      startNegotiation(
        {
          offerId: offer.offerId,
          assetId: offer.assetId,
          providerDid: offer.providerDid,
          dspEndpoint: offer.dspEndpoint,
          offerPolicy: offer.offerPolicy,
        },
        connectorId!
      ),
    onSuccess: () => {
      toast.success(t.catalog.negotiationStarted);
      onNav(`/connectors/${connectorId}/negotiation`);
    },
    onError: () => {
      toast.error(t.catalog.negotiationFailed);
    },
    onSettled: () => {
      setPendingOfferId(null);
    },
  });

  const handleNegotiate = (o: CatalogOffer) => {
    setPendingOfferId(o.offerId);
    negMutation.mutate(o);
  };

  // 현재 커넥터의 DSP 엔드포인트 / DID (참고용)
  const myDsp = connector?.dspEndpoint;
  const myDid = connector?.did;

  return (
    <>
      <SectionHdr
        icon={<Search className="w-5 h-5 text-primary" />}
        subtitle={t.pageSubtitles.catalog}
      >
        {t.catalog.title}
      </SectionHdr>

      {/* 현재 커넥터 참고 정보 */}
      {(myDsp || myDid) && (
        <div className="mb-3 px-3 py-2 rounded-md bg-muted/60 border border-border flex flex-col gap-1">
          <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground font-semibold">
            <Info className="w-3 h-3" />
            {t.catalog.myConnectorInfo}
          </div>
          {myDsp && (
            <div className="text-[12px] font-normal text-foreground/70 break-all">
              DSP: {myDsp}
            </div>
          )}
          {myDid && (
            <div className="text-[12px] font-normal text-foreground/70 break-all">
              DID: {myDid}
            </div>
          )}
        </div>
      )}

      <Card
        title={
          <CardTitle icon={<Search className="w-3.5 h-3.5 text-blue-500" />}>
            {t.catalog.queryTitle}
          </CardTitle>
        }
      >
        <div className="flex flex-col gap-2 mb-4">
          {/* 빠른 선택: 등록 커넥터/최근 조회 → DSP·DID 자동 채움 (수동 입력은 아래에서 유지) */}
          {peers.length > 0 && (
            <FormField label={t.catalog.quickSelect}>
              <select
                value={pick}
                onChange={e => handlePick(e.target.value)}
                className={inputBase}
              >
                <option value="">{t.catalog.manualEntry}</option>
                <optgroup label={t.catalog.registeredConnectors}>
                  {peers.map(c => (
                    <option key={c.id} value={`conn:${c.id}`}>
                      {c.name} · {c.bpn}
                    </option>
                  ))}
                </optgroup>
              </select>
            </FormField>
          )}
          {/* 최근 조회 — 클릭 시 DSP·DID 자동 채움, 우측 X 로 제거 (native option 은 X 불가하여 목록으로) */}
          {recent.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-muted-foreground">
                {t.catalog.recentQueries}
              </span>
              {recent.map(r => (
                <div
                  key={`${r.url}|${r.counterPartyId}`}
                  className="flex items-center gap-1 rounded-md border border-border bg-card hover:border-primary/40 hover:bg-primary/5 transition-colors"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setUrl(r.url);
                      setCounterPartyId(r.counterPartyId);
                      // 빠른선택을 manual-entry 로 되돌려 같은 커넥터 재선택 시에도 onChange 가 발화하게 한다.
                      setPick("");
                    }}
                    className="flex-1 min-w-0 text-left px-2.5 py-1.5 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded-l-md"
                  >
                    <span className="block mono text-[12px] text-foreground truncate">
                      {r.counterPartyId}
                    </span>
                    <span className="block mono text-[10px] text-muted-foreground truncate">
                      {r.url}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setRecent(removeRecent(r))}
                    aria-label={t.common.delete}
                    title={t.common.delete}
                    className="flex-shrink-0 mr-1 p-1.5 rounded text-muted-foreground hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-rose-400"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {/* DSP Endpoint */}
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Globe className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                value={url}
                onChange={e => {
                  setUrl(e.target.value);
                  setPick("");
                }}
                placeholder={t.catalog.dspPlaceholder}
                aria-label={t.catalog.dspLabel}
                list={fhId("catalog.dspEndpoint")}
                className={`${inputBase} pl-8 mono placeholder:font-sans placeholder:font-normal`}
              />
              <HistoryDatalist
                id={fhId("catalog.dspEndpoint")}
                options={suggestions["catalog.dspEndpoint"]}
              />
            </div>
          </div>
          {/* Counter-party DID */}
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Building2 className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                value={counterPartyId}
                onChange={e => {
                  setCounterPartyId(e.target.value);
                  setPick("");
                }}
                placeholder={t.catalog.bpnPlaceholder}
                aria-label={t.catalog.bpnLabel}
                list={fhId("catalog.counterPartyId")}
                className={`${inputBase} pl-8 mono placeholder:font-sans placeholder:font-normal`}
              />
              <HistoryDatalist
                id={fhId("catalog.counterPartyId")}
                options={suggestions["catalog.counterPartyId"]}
              />
            </div>
            <PrimaryActionButton
              onClick={handleQuery}
              disabled={loading || !connectorId}
              icon={
                loading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Search className="w-3.5 h-3.5" />
                )
              }
              className="justify-center sm:w-auto w-full text-[12px] px-3 py-1.5"
            >
              {loading ? t.catalog.querying : t.catalog.query}
            </PrimaryActionButton>
          </div>
          {/* 맨 BPN 입력 시 서버 정규화(DID) 미리보기 — 설정 participantId 힌트와 동일 형식 */}
          {/^BPNL[0-9A-Z]+$/i.test(counterPartyId.trim()) && (
            <p className="text-[10px] text-muted-foreground break-all -mt-1">
              →{" "}
              <span className="mono">
                did:web:identityhub:participants:{counterPartyId.trim()}
              </span>
            </p>
          )}
        </div>

        {!loaded && !error && (
          <ListEmpty icon={<Search />} message={t.catalog.initialHint} />
        )}
        {loaded && error && (
          <ListError onRetry={handleQuery} fetching={loading} message={error} />
        )}
        {loaded && !error && (
          <CatalogResults
            offers={offers}
            onNegotiate={handleNegotiate}
            isRowPending={o =>
              negMutation.isPending && pendingOfferId === o.offerId
            }
          />
        )}
      </Card>
    </>
  );
}

/* ─── Catalog Results Table (asset-style) ────────────────────── */
function CatalogResults({
  offers,
  onNegotiate,
  isRowPending,
}: {
  offers: CatalogOffer[];
  onNegotiate: (o: CatalogOffer) => void;
  isRowPending: (o: CatalogOffer) => boolean;
}) {
  const { t } = useI18n();
  const {
    paginatedData,
    totalItems,
    currentPage,
    pageSize,
    setCurrentPage,
    setPageSize,
  } = usePagination(offers, 10);

  // 0건이면 카운트/빈 헤더 테이블 대신 빈 상태 하나만 노출(중복 제거).
  if (offers.length === 0) {
    return <ListEmpty icon={<Package />} message={t.common.noResults} />;
  }

  return (
    <>
      <div className="text-[11px] text-muted-foreground mb-3 flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-primary" />
        {t.catalog.offersFound(offers.length)}
      </div>

      {/* Desktop/Tablet: Table */}
      <div className="hidden md:block bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px]">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-3 text-left text-[12px] font-bold text-foreground">
                  {t.assets.col.name}
                </th>
                <th className="px-4 py-3 text-left text-[12px] font-bold text-foreground">
                  {t.assets.col.type}
                </th>
                <th className="px-4 py-3 text-left text-[12px] font-bold text-foreground">
                  {t.policies.title}
                </th>
                <th className="px-4 py-3 text-right text-[12px] font-bold text-foreground">
                  {t.catalog.startNegotiation}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {paginatedData.map((o, i) => (
                <tr key={`${o.offerId}-${i}`} className="table-row-hover group">
                  <td className="px-4 py-3">
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-primary truncate">
                        {o.name}
                      </div>
                      {o.src && (
                        <div className="text-xs text-foreground truncate">
                          {o.src}
                        </div>
                      )}
                      {/* AAS 연계 — 이 오퍼가 어느 디지털 트윈의 데이터인지(서버 attachAasLinks) */}
                      {o.aasId && (
                        <div
                          className="flex items-center gap-1 mt-0.5 text-[10px] text-violet-600 dark:text-violet-400 truncate"
                          title={o.aasId}
                        >
                          <Boxes className="w-3 h-3 flex-shrink-0" />
                          {t.catalog.twinLink}: {o.aasIdShort || o.aasId}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="blue" className="!font-normal">
                      {o.type}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {o.pols.length === 0 ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        o.pols.map((p, pi) => (
                          <Badge
                            key={`${p}-${pi}`}
                            variant="purple"
                            className="!font-normal"
                          >
                            {p}
                          </Badge>
                        ))
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <RoleGate permission="transaction:write">
                      <button
                        onClick={() => onNegotiate(o)}
                        disabled={isRowPending(o)}
                        className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md bg-primary hover:bg-primary/90 text-primary-foreground font-medium transition-colors disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
                      >
                        {t.catalog.startNegotiation}{" "}
                        {isRowPending(o) ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <ArrowRight className="w-3 h-3" />
                        )}
                      </button>
                    </RoleGate>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
        </div>
      </div>

      {/* Mobile: Card Stack */}
      <div className="md:hidden flex flex-col gap-2.5">
        {paginatedData.map((o, i) => (
          <div
            key={`${o.offerId}-${i}`}
            className="bg-card rounded-xl p-3.5 shadow-sm border border-border"
          >
            <div className="text-xs font-medium text-primary truncate mb-0.5">
              {o.name}
            </div>
            <div className="text-xs text-foreground truncate mb-2">
              {o.type}
              {o.src ? ` · ${o.src}` : ""}
            </div>
            {o.aasId && (
              <div
                className="flex items-center gap-1 -mt-1 mb-2 text-[10px] text-violet-600 dark:text-violet-400 truncate"
                title={o.aasId}
              >
                <Boxes className="w-3 h-3 flex-shrink-0" />
                {t.catalog.twinLink}: {o.aasIdShort || o.aasId}
              </div>
            )}
            <div className="flex flex-wrap gap-1 mb-3">
              {o.pols.map((p, pi) => (
                <Badge
                  key={`${p}-${pi}`}
                  variant="purple"
                  className="!font-normal"
                >
                  {p}
                </Badge>
              ))}
            </div>
            <RoleGate permission="transaction:write">
              <button
                onClick={() => onNegotiate(o)}
                disabled={isRowPending(o)}
                className={cn(
                  "w-full inline-flex items-center justify-center gap-1 text-xs px-2.5 py-1.5 rounded-md bg-primary hover:bg-primary/90 text-primary-foreground font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1",
                  isRowPending(o) && "opacity-60"
                )}
              >
                {t.catalog.startNegotiation}{" "}
                {isRowPending(o) ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <ArrowRight className="w-3 h-3" />
                )}
              </button>
            </RoleGate>
          </div>
        ))}
      </div>
    </>
  );
}
