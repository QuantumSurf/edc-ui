// 셸 단위 AAS 적합성 패널 — 디스크립터 레벨 규칙(aasConformance)을 종합 판정으로
// 보여주고 JSON 리포트로 내려받게 한다. 폼 레벨 힌트(FieldWarn)가 입력 순간을
// 지킨다면, 이 패널은 등록된 셸의 현재 상태를 사후 점검한다(비차단·인지형).
import { useMemo } from "react";
import { CheckCircle2, AlertTriangle, XCircle, Download } from "lucide-react";
import type { ShellDescriptor } from "@/lib/data";
import {
  checkShellConformance,
  type ConformanceLevel,
} from "@/lib/aasConformance";
import { useI18n } from "@/i18n";

const LEVEL_STYLE: Record<
  ConformanceLevel,
  { icon: typeof CheckCircle2; cls: string }
> = {
  pass: { icon: CheckCircle2, cls: "text-emerald-600 dark:text-emerald-400" },
  warn: { icon: AlertTriangle, cls: "text-amber-600 dark:text-amber-400" },
  fail: { icon: XCircle, cls: "text-red-600 dark:text-red-400" },
};

export default function ShellConformancePanel({
  shell,
}: {
  shell: ShellDescriptor;
}) {
  const { t, locale } = useI18n();
  const report = useMemo(
    () => checkShellConformance(shell, locale === "ko" ? "ko" : "en"),
    [shell, locale]
  );
  const Overall = LEVEL_STYLE[report.overall];

  const downloadJson = () => {
    const payload = {
      aasId: shell.id,
      idShort: shell.idShort,
      checkedAt: new Date().toISOString(),
      overall: report.overall,
      summary: report.summary,
      rules: report.rules,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `aas-conformance-${(shell.idShort || "shell").replace(/[^\w-]+/g, "_")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-2 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <div className={`flex items-center gap-1.5 ${Overall.cls}`}>
          <Overall.icon className="w-4 h-4" />
          <span className="text-xs font-semibold">
            {t.twins.conformance[report.overall]}
          </span>
          <span className="text-[11px] text-muted-foreground font-normal">
            (pass {report.summary.pass} · warn {report.summary.warn} · fail{" "}
            {report.summary.fail})
          </span>
        </div>
        <button
          onClick={downloadJson}
          className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border border-border hover:bg-muted text-muted-foreground hover:text-foreground flex-shrink-0"
        >
          <Download className="w-3 h-3" />
          {t.twins.conformance.export}
        </button>
      </div>
      <ul className="space-y-1">
        {report.rules.map(rule => {
          const S = LEVEL_STYLE[rule.level];
          return (
            <li key={rule.id} className="flex items-start gap-1.5 min-w-0">
              <S.icon className={`w-3.5 h-3.5 mt-px flex-shrink-0 ${S.cls}`} />
              <div className="min-w-0">
                <span className="text-[12px] text-foreground">
                  {rule.label}
                </span>
                <span className="text-[11px] text-muted-foreground break-all">
                  {" — "}
                  {rule.detail}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-[10px] text-muted-foreground">
        {t.twins.conformance.note}
      </p>
    </div>
  );
}
