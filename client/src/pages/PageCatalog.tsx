// Connector Hub — Catalog Browser (spec 4.5)
// DSP Endpoint input → catalog query → negotiation start flow

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { fetchCatalog, startNegotiation } from "@/services";
import { type CatalogOffer } from "@/lib/data";
import { useConnectorStore } from "@/stores/connectorStore";
import { Card, Badge, SectionHdr, CardTitle, inputBase, PrimaryActionButton, ListError, ListEmpty } from "@/components/ui-kmx";
import { DataTablePagination, usePagination } from "@/components/DataTablePagination";
import { Search, Globe, ArrowRight, Loader2, Building2, Info, Package } from "lucide-react";
import { toast } from "sonner";
import { RoleGate } from "@/components/RoleGate";
import { cn } from "@/lib/utils";

interface PageCatalogProps {
  onNav: (path: string) => void;
}

export default function PageCatalog({ onNav }: PageCatalogProps) {
  const { t } = useI18n();
  const connector = useConnectorStore((s) => s.connector);
  const connectorId = connector?.id;
  const [url, setUrl] = useState("");
  const [counterPartyId, setCounterPartyId] = useState("");
  const [offers, setOffers] = useState<CatalogOffer[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleQuery = async () => {
    if (!url.trim()) {
      toast.error(t.catalog.dspRequired);
      return;
    }
    if (!counterPartyId.trim()) {
      toast.error(t.catalog.bpnRequired);
      return;
    }
    if (!connectorId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchCatalog(url, counterPartyId, connectorId);
      setOffers(result);
      setLoaded(true);
    } catch (err: unknown) {
      // EDC가 돌려준 actionable 에러(4xx 검증·SSRF 거부, 5xx 자격증명/구성 실패 등)는
      // 실제 원인 메시지를 노출, 그 외(전송/내부 마스킹)는 로컬라이즈된 안내 문구를 사용.
      const e = err as { response?: { status?: number; data?: { error?: string; actionable?: boolean } } };
      const status = e?.response?.status;
      const data = e?.response?.data;
      const showServerMsg = (data?.actionable || (status != null && status < 500)) && typeof data?.error === "string";
      const msg = showServerMsg ? (data!.error as string) : t.catalog.queryFailed;
      toast.error(msg);
      setError(msg);
      setOffers([]);
      setLoaded(true);
    } finally {
      setLoading(false);
    }
  };

  const negMutation = useMutation({
    mutationFn: (offer: CatalogOffer) => startNegotiation(
      { offerId: offer.offerId, assetId: offer.assetId, providerDid: offer.providerDid, dspEndpoint: offer.dspEndpoint, offerPolicy: offer.offerPolicy },
      connectorId!
    ),
    onSuccess: () => {
      toast.success(t.catalog.negotiationStarted);
      onNav(`/connectors/${connectorId}/negotiation`);
    },
    onError: () => {
      toast.error(t.catalog.negotiationFailed);
    },
  });

  // 현재 커넥터의 DSP 엔드포인트 / DID (참고용)
  const myDsp = connector?.dspEndpoint;
  const myDid = connector?.did;

  return (
    <>
      <SectionHdr icon={<Search className="w-5 h-5 text-primary" />}>{t.catalog.title}</SectionHdr>

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

      <Card title={<CardTitle icon={<Search className="w-3.5 h-3.5 text-blue-500" />}>{t.catalog.queryTitle}</CardTitle>}>
        <div className="flex flex-col gap-2 mb-4">
          {/* DSP Endpoint */}
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Globe className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={t.catalog.dspPlaceholder}
                aria-label={t.catalog.dspLabel}
                className={`${inputBase} pl-8 mono`}
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
                onChange={(e) => setCounterPartyId(e.target.value)}
                placeholder={t.catalog.bpnPlaceholder}
                aria-label={t.catalog.bpnLabel}
                className={`${inputBase} pl-8 mono`}
              />
            </div>
            <PrimaryActionButton
              onClick={handleQuery}
              disabled={loading || !connectorId}
              icon={loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
              className="justify-center sm:w-auto w-full text-[12px] px-3 py-1.5"
            >
              {loading ? t.catalog.querying : t.catalog.query}
            </PrimaryActionButton>
          </div>
          {/* 맨 BPN 입력 시 서버 정규화(DID) 미리보기 — 설정 participantId 힌트와 동일 형식 */}
          {/^BPNL[0-9A-Z]+$/i.test(counterPartyId.trim()) && (
            <p className="text-[10px] text-muted-foreground break-all -mt-1">
              → <span className="mono">did:web:identityhub:participants:{counterPartyId.trim()}</span>
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
          <CatalogResults offers={offers} onNegotiate={(o) => negMutation.mutate(o)} negotiating={negMutation.isPending} />
        )}
      </Card>
    </>
  );
}

/* ─── Catalog Results Table (asset-style) ────────────────────── */
function CatalogResults({ offers, onNegotiate, negotiating }: { offers: CatalogOffer[]; onNegotiate: (o: CatalogOffer) => void; negotiating: boolean }) {
  const { t } = useI18n();
  const { paginatedData, totalItems, currentPage, pageSize, setCurrentPage, setPageSize } = usePagination(offers, 10);

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
                <th className="px-4 py-3 text-left text-[12px] font-bold text-foreground">{t.assets.col.name}</th>
                <th className="px-4 py-3 text-left text-[12px] font-bold text-foreground">{t.assets.col.type}</th>
                <th className="px-4 py-3 text-left text-[12px] font-bold text-foreground">{t.policies.title}</th>
                <th className="px-4 py-3 text-right text-[12px] font-bold text-foreground">{t.catalog.startNegotiation}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {paginatedData.map((o, i) => (
                <tr key={`${o.offerId}-${i}`} className="table-row-hover group">
                  <td className="px-4 py-3">
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-primary truncate">{o.name}</div>
                      {o.src && <div className="text-xs text-foreground truncate">{o.src}</div>}
                    </div>
                  </td>
                  <td className="px-4 py-3"><Badge variant="blue" className="!font-normal">{o.type}</Badge></td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {o.pols.length === 0 ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : o.pols.map((p) => (
                        <Badge key={p} variant="purple" className="!font-normal">{p}</Badge>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <RoleGate permission="transaction:write">
                      <button
                        onClick={() => onNegotiate(o)}
                        disabled={negotiating}
                        className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md bg-primary hover:bg-primary/90 text-primary-foreground font-medium transition-colors disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
                      >
                        {t.catalog.startNegotiation} <ArrowRight className="w-3 h-3" />
                      </button>
                    </RoleGate>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {offers.length === 0 && (
            <ListEmpty icon={<Package />} message={t.common.noResults} />
          )}
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
          <div key={`${o.offerId}-${i}`} className="bg-card rounded-xl p-3.5 shadow-sm border border-border">
            <div className="text-xs font-medium text-primary truncate mb-0.5">{o.name}</div>
            <div className="text-xs text-foreground truncate mb-2">{o.type}{o.src ? ` · ${o.src}` : ""}</div>
            <div className="flex flex-wrap gap-1 mb-3">
              {o.pols.map((p) => (
                <Badge key={p} variant="purple" className="!font-normal">{p}</Badge>
              ))}
            </div>
            <RoleGate permission="transaction:write">
              <button
                onClick={() => onNegotiate(o)}
                disabled={negotiating}
                className={cn("w-full inline-flex items-center justify-center gap-1 text-xs px-2.5 py-1.5 rounded-md bg-primary hover:bg-primary/90 text-primary-foreground font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1", negotiating && "opacity-60")}
              >
                {t.catalog.startNegotiation} <ArrowRight className="w-3 h-3" />
              </button>
            </RoleGate>
          </div>
        ))}
      </div>
    </>
  );
}
