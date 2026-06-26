// KMX EDC — Sidebar resource count hook
// BFF 의 경량 count 엔드포인트(GET /connectors/:id/counts)에서 6개 리소스 카운트를 한 번에 받는다.
// (과거: assets/policies/offerings/negotiations/transfers/edrs 6개 풀리스트를 각각 페치해
//  .length 로 세던 over-fetch → 단일 경량 요청으로 대체. 페이로드·라운드트립 대폭 절감.)

import { useQuery } from "@tanstack/react-query";
import { fetchSidebarCounts } from "@/services";

export interface SidebarCounts {
  assets?: number;
  policies?: number;
  offerings?: number;
  negotiations?: number;
  transfers?: number;
  edrs?: number;
}

export function useSidebarCounts(connectorId: string | null): SidebarCounts {
  const { data } = useQuery({
    queryKey: ["sidebar-counts", connectorId],
    queryFn: () => fetchSidebarCounts(connectorId!),
    enabled: !!connectorId,
    staleTime: 60_000,
  });
  return data ?? {};
}
