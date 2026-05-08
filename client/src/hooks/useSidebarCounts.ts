// KMX EDC — Sidebar resource count hook
// Fetches live counts from the BFF for each resource type

import { useQuery } from "@tanstack/react-query";
import {
  fetchAssets, fetchPolicies, fetchOfferings,
  fetchNegotiations, fetchTransfers, fetchEDRs,
} from "@/services";

export interface SidebarCounts {
  assets?: number;
  policies?: number;
  offerings?: number;
  negotiations?: number;
  transfers?: number;
  edrs?: number;
}

export function useSidebarCounts(connectorId: string | null): SidebarCounts {
  const enabled = !!connectorId;

  const { data: assets } = useQuery({
    queryKey: ["assets", connectorId],
    queryFn: () => fetchAssets(connectorId!),
    enabled,
    staleTime: 60_000,
  });

  const { data: policies } = useQuery({
    queryKey: ["policies", connectorId],
    queryFn: () => fetchPolicies(connectorId!),
    enabled,
    staleTime: 60_000,
  });

  const { data: offerings } = useQuery({
    queryKey: ["offerings", connectorId],
    queryFn: () => fetchOfferings(connectorId!),
    enabled,
    staleTime: 60_000,
  });

  const { data: negotiations } = useQuery({
    queryKey: ["negotiations", connectorId],
    queryFn: () => fetchNegotiations(connectorId!),
    enabled,
    staleTime: 60_000,
  });

  const { data: transfers } = useQuery({
    queryKey: ["transfers", connectorId],
    queryFn: () => fetchTransfers(connectorId!),
    enabled,
    staleTime: 60_000,
  });

  const { data: edrs } = useQuery({
    queryKey: ["edrs", connectorId],
    queryFn: () => fetchEDRs(connectorId!),
    enabled,
    staleTime: 60_000,
  });

  return {
    assets: assets?.length,
    policies: policies?.length,
    offerings: offerings?.length,
    negotiations: negotiations?.length,
    transfers: transfers?.length,
    edrs: edrs?.length,
  };
}
