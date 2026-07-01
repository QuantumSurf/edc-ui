// KMX EDC — Sidebar resource count hook
// BFF 의 경량 count 엔드포인트(GET /connectors/:id/counts)에서 6개 리소스 카운트를 한 번에 받는다.
// (과거: assets/policies/offerings/negotiations/transfers/edrs 6개 풀리스트를 각각 페치해
//  .length 로 세던 over-fetch → 단일 경량 요청으로 대체. 페이로드·라운드트립 대폭 절감.)

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchSidebarCounts } from "@/services";

export interface SidebarCounts {
  assets?: number;
  policies?: number;
  offerings?: number;
  negotiations?: number;
  transfers?: number;
  edrs?: number;
}

// 사이드바 배지가 세는 리소스들의 React Query 키 prefix.
// 이 키들이 무효화되면(=생성/수정/삭제 후) 카운트도 다시 받아야 한다.
const COUNTED_RESOURCE_KEYS = new Set([
  "assets",
  "policies",
  "offerings",
  "negotiations",
  "transfers",
  "edrs",
]);

export function useSidebarCounts(connectorId: string | null): SidebarCounts {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["sidebar-counts", connectorId],
    queryFn: () => fetchSidebarCounts(connectorId!),
    enabled: !!connectorId,
    staleTime: 60_000,
  });

  // 각 페이지(PageAssets/PagePolicy/PageOffering/…)는 생성·삭제 후 자기 목록 키
  // (예: ["policies", connectorId])만 invalidate 하고 ["sidebar-counts", …] 는
  // 건드리지 않아, 표는 갱신돼도 사이드바 배지가 stale 로 남았다(자산·정책·계약 공통).
  // 무효화 지점이 여러 곳에 흩어져 있으므로 여기 한 곳에서 캐시 이벤트를 구독해,
  // 카운트 대상 리소스가 무효화되면 사이드바 카운트도 함께 무효화한다.
  useEffect(() => {
    if (!connectorId) return;
    const cache = queryClient.getQueryCache();
    return cache.subscribe(event => {
      // 명시적 invalidate 이벤트만 반응(일반 fetch/success/error 는 무시 → 루프 방지).
      if (event.type !== "updated" || event.action?.type !== "invalidate") return;
      const key0 = event.query.queryKey?.[0];
      if (typeof key0 === "string" && COUNTED_RESOURCE_KEYS.has(key0)) {
        // sidebar-counts 자신은 COUNTED 에 없으므로 재귀 무효화 루프가 생기지 않는다.
        queryClient.invalidateQueries({
          queryKey: ["sidebar-counts", connectorId],
        });
      }
    });
  }, [queryClient, connectorId]);

  return data ?? {};
}
