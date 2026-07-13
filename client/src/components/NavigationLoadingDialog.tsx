// Connector Hub — 커넥터 페이지 전환/데이터 로딩 중 표시되는 전역 로딩 다이얼로그.
import { useConnectorStore } from "@/stores/connectorStore";
import { useIsFetching } from "@tanstack/react-query";
import { useI18n } from "@/i18n";

// 시크릿(Vault)·분산신원(IdentityHub) 페이지의 폴링/시스템 조회는 전역 블로킹 모달에서
// 제외한다. 이 페이지들은 데모 폴백·카드별 인라인 로딩으로 즉시 렌더되므로, 풀스크린 모달이
// 백그라운드 폴링·느린 응답(15s 타임아웃)마다 떠 "로딩이 길다"는 체감만 유발한다.
const NON_BLOCKING_QUERY_KEYS = new Set([
  "platform-vault",
  "identity-hub-participant",
  "identity-hub-health",
]);

export default function NavigationLoadingDialog() {
  const { t } = useI18n();
  const navigating = useConnectorStore(s => s.navigating);
  const connector = useConnectorStore(s => s.connector);
  // 첫 로드(데이터 없음)만 풀스크린 모달로 차단한다. 이미 데이터가 있는 쿼리의 백그라운드 refetch
  // (폴링 30~60s·창 포커스 등)는 q.state.data 가 존재하므로 제외 — 폴링마다 모달이 깜빡이지 않게.
  const isFetching = useIsFetching({
    predicate: q =>
      !NON_BLOCKING_QUERY_KEYS.has(q.queryKey?.[0] as string) &&
      q.state.data === undefined,
  });
  const visible = navigating || isFetching > 0;

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div className="bg-card border border-border rounded-xl shadow-2xl px-8 py-6 flex flex-col items-center gap-4 min-w-[220px]">
        <div className="relative w-12 h-12">
          <div className="absolute inset-0 rounded-full border-[3px] border-border" />
          <div className="absolute inset-0 rounded-full border-[3px] border-transparent border-t-blue-500 animate-spin" />
        </div>
        {/* 오버레이 표시 시 스크린리더가 로딩 문구를 자동 낭독 (WCAG 4.1.3) */}
        <div
          className="flex flex-col items-center gap-1 text-center"
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          {connector ? (
            <>
              <span className="text-[15px] font-semibold text-foreground">
                {connector.name}
              </span>
              <span className="text-[12px] text-muted-foreground">
                {t.common.loadingData}
              </span>
            </>
          ) : (
            <span className="text-[15px] font-semibold text-foreground">
              {t.common.loading}
            </span>
          )}
        </div>
        <div className="w-full h-[3px] bg-border rounded-full overflow-hidden">
          <div className="h-full w-1/2 bg-blue-500 nav-progress-bar rounded-full" />
        </div>
      </div>
    </div>
  );
}
