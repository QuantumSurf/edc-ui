// 대량 데이터 전송 실시간 진행률 패널 (Nexon 다운로더식) — 전체/현재 파일 진행바 +
// 속도(MB/s) + 남은시간(ETA) + 파일 N개 중 M개 + 취소. 스냅샷은 useTransferProgress 가 공급.

import { useI18n } from "@/i18n";
import { ProgressBar } from "@/components/ui-kmx";
import {
  formatBytes,
  formatSpeed,
  etaParts,
  percent,
} from "@/lib/formatTransfer";
import type { TransferProgressSnapshot } from "@/hooks/useTransferProgress";

interface Props {
  snapshot: TransferProgressSnapshot | null;
  onCancel?: () => void;
  canceling?: boolean;
}

const STATE_COLOR: Record<string, string> = {
  RUNNING: "bg-blue-500",
  COMPLETED: "bg-emerald-500",
  FAILED: "bg-red-500",
  CANCELED: "bg-gray-400",
  PENDING: "bg-blue-400",
};

export function TransferProgress({ snapshot, onCancel, canceling }: Props) {
  const { t } = useI18n();
  if (!snapshot) return null;
  const b = t.transfers.bulk;

  const overallPct = percent(snapshot.transferredBytes, snapshot.totalBytes);
  const filePct = percent(snapshot.currentFileBytes, snapshot.currentFileTotal);
  const eta = etaParts(snapshot.etaSec);
  const color = STATE_COLOR[snapshot.state] ?? "bg-blue-500";
  const multi = snapshot.fileCount > 1;
  const running = snapshot.state === "RUNNING" || snapshot.state === "PENDING";

  return (
    <div
      className="rounded-lg border border-border bg-card p-4 space-y-3"
      role="group"
      aria-label={b.title}
    >
      {/* 헤더: 상태 + 파일 N/M + 취소 */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <span>{b.states[snapshot.state]}</span>
          {multi && (
            <span className="text-xs text-muted-foreground">
              {b.filesProgress(snapshot.filesDone, snapshot.fileCount)}
            </span>
          )}
        </div>
        {running && onCancel && (
          <button
            onClick={onCancel}
            disabled={canceling}
            className="px-2.5 py-1 text-xs font-medium text-red-500 hover:bg-red-100 dark:hover:bg-red-500/15 rounded-md transition-colors disabled:opacity-50"
          >
            {canceling ? b.canceling : b.cancel}
          </button>
        )}
      </div>

      {/* 전체 진행바 */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{b.overall}</span>
          <span className="tabular-nums" aria-live="polite" aria-atomic="true">
            {b.ofValue(
              formatBytes(snapshot.transferredBytes),
              formatBytes(snapshot.totalBytes)
            )}
            {overallPct != null && `  ·  ${overallPct.toFixed(0)}%`}
          </span>
        </div>
        {running && overallPct == null ? (
          // 총량 미상 + 진행 중 → 불확정(indeterminate) 바(0% 고정처럼 보이지 않게).
          <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className={`h-full w-1/3 rounded-full animate-pulse ${color}`}
            />
          </div>
        ) : (
          <ProgressBar value={overallPct ?? 0} colorClass={color} />
        )}
      </div>

      {/* 현재 파일 진행바(다수 파일일 때) */}
      {multi && snapshot.currentFile && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="truncate max-w-[60%]" title={snapshot.currentFile}>
              {b.currentFile}: {snapshot.currentFile}
            </span>
            <span className="tabular-nums">
              {b.ofValue(
                formatBytes(snapshot.currentFileBytes),
                formatBytes(snapshot.currentFileTotal)
              )}
            </span>
          </div>
          <ProgressBar value={filePct ?? 0} colorClass={color} />
        </div>
      )}

      {/* 진행 중일 때만 속도·남은시간(터미널에선 정지값 박제·'0초'를 피해 숨긴다) */}
      {running && (
        <div className="flex items-center gap-6 text-xs">
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">{b.speed}</span>
            <span className="tabular-nums font-medium">
              {formatSpeed(snapshot.bytesPerSec)}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">{b.eta}</span>
            <span className="tabular-nums font-medium">
              {snapshot.totalBytes == null
                ? "—" // 총량 미상 → ETA 계산 불가('계산 중'으로 오도하지 않음)
                : eta
                  ? b.etaValue(eta.h, eta.m, eta.s)
                  : b.computing}
            </span>
          </div>
        </div>
      )}

      {/* 취소/실패 시: 계약(EDC) 전송은 여전히 활성 — 배지 '진행 중'과 모순처럼 보이지 않게 안내 */}
      {(snapshot.state === "CANCELED" || snapshot.state === "FAILED") && (
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          {b.terminalNote}
        </p>
      )}

      {snapshot.state === "FAILED" && snapshot.error && (
        <p className="text-xs text-red-600 dark:text-red-400 break-all">
          {snapshot.error}
        </p>
      )}
    </div>
  );
}
