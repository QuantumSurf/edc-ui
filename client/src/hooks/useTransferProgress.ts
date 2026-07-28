// 대량 전송 실시간 진행률 구독 훅 — SSE(EventSource) 우선, 실패/미지원 시 폴링 폴백.
// 서버: GET /api/connectors/:id/transfers/:tpId/progress/stream (SSE) · /progress (스냅샷)

import { useEffect, useState } from "react";

export interface TransferProgressSnapshot {
  transferId: string;
  connectorId: string;
  state: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELED";
  totalBytes: number | null;
  transferredBytes: number;
  fileCount: number;
  filesDone: number;
  currentFile: string | null;
  currentFileBytes: number;
  currentFileTotal: number | null;
  bytesPerSec: number | null;
  etaSec: number | null;
  error?: string;
}

function isTerminal(s: string): boolean {
  return s === "COMPLETED" || s === "FAILED" || s === "CANCELED";
}

export function useTransferProgress(
  connectorId: string | null,
  tpId: string | null,
  enabled: boolean
): { snapshot: TransferProgressSnapshot | null } {
  const [snapshot, setSnapshot] = useState<TransferProgressSnapshot | null>(
    null
  );

  useEffect(() => {
    if (!enabled || !connectorId || !tpId) {
      setSnapshot(null);
      return;
    }
    const base = `/api/connectors/${encodeURIComponent(
      connectorId
    )}/transfers/${encodeURIComponent(tpId)}`;
    let es: EventSource | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let stopped = false;

    // 진행 중 전송량을 단조 증가로 클램프 — 크래시 재개 시 새 잡이 0부터 카운트해 진행바가
    // 순간 역행(예 60%→0%)하는 깜빡임을 막는다(터미널은 서버 값을 그대로 반영).
    let maxBytes = 0;
    const apply = (s: TransferProgressSnapshot): void => {
      if (
        (s.state === "RUNNING" || s.state === "PENDING") &&
        s.transferredBytes < maxBytes
      ) {
        setSnapshot({ ...s, transferredBytes: maxBytes });
        return;
      }
      maxBytes = Math.max(maxBytes, s.transferredBytes);
      setSnapshot(s);
    };

    const stopPolling = (): void => {
      if (pollTimer != null) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    const startPolling = (): void => {
      if (pollTimer != null) return;
      const tick = async (): Promise<void> => {
        try {
          const r = await fetch(`${base}/progress`, {
            credentials: "same-origin",
          });
          if (!r.ok) return;
          const s = (await r.json()) as TransferProgressSnapshot;
          if (stopped) return;
          apply(s);
          if (isTerminal(s.state)) stopPolling();
        } catch {
          /* 폴링 실패 무시(다음 주기 재시도) */
        }
      };
      pollTimer = setInterval(tick, 1500);
      void tick();
    };

    try {
      es = new EventSource(`${base}/progress/stream`, {
        withCredentials: true,
      });
      es.onmessage = ev => {
        try {
          const s = JSON.parse(ev.data) as TransferProgressSnapshot;
          if (stopped) return;
          apply(s);
          if (isTerminal(s.state)) es?.close();
        } catch {
          /* 파싱 실패 무시 */
        }
      };
      es.onerror = () => {
        // SSE 연결 실패/미지원 → 폴링으로 폴백.
        es?.close();
        es = null;
        if (!stopped) startPolling();
      };
    } catch {
      startPolling();
    }

    return () => {
      stopped = true;
      es?.close();
      stopPolling();
    };
  }, [connectorId, tpId, enabled]);

  return { snapshot };
}
