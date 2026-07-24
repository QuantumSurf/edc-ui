// 서브모델 실본문(AAS Part 2 Submodel Interface) 뷰어.
// 디스크립터(껍데기) 너머의 실제 submodelElements 트리를 읽기 전용으로 보여준다 —
// 이게 없으면 콘솔은 "디스크립터 브라우저"에 머물러, 등록된 트윈 데이터가 실제로
// 무엇인지(값·구조·element별 semanticId) 확인할 수 없다.
// 데이터는 BFF 프록시(GET /dtr/shells/:aasId/submodels/:submodelId/content)가
// SSRF 가드 하에 endpoint href 를 따라가 가져온다.
import { useQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileJson,
  Loader2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { fetchSubmodelContent } from "@/services";
import { useI18n } from "@/i18n";
import { recognizeSemanticId } from "@/lib/semanticTemplates";
import { MonoText } from "@/components/ui-kmx";

/* ── AAS Part 2 submodelElement 탐색 헬퍼 ─────────────────────── */

type Rec = Record<string, unknown>;
const asRec = (v: unknown): Rec | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : null;

/** element 의 semanticId — { keys: [{ value }] } 또는 문자열 폼 모두 수용. */
function elementSemanticId(el: Rec): string {
  const sem = el["semanticId"];
  if (typeof sem === "string") return sem;
  const keys = asRec(sem)?.["keys"];
  if (Array.isArray(keys) && keys.length > 0) {
    const v = asRec(keys[0])?.["value"];
    if (typeof v === "string") return v;
  }
  return "";
}

/** 자식 요소 배열 — SMC(value)·Submodel(submodelElements)·Entity(statements). */
function childElements(el: Rec): Rec[] {
  for (const key of ["submodelElements", "statements", "annotations"]) {
    const v = el[key];
    if (Array.isArray(v)) return v.map(asRec).filter((x): x is Rec => !!x);
  }
  // SubmodelElementCollection/List: value 가 배열이면 자식, 아니면 리프 값.
  const v = el["value"];
  if (Array.isArray(v) && v.every(x => asRec(x)?.["idShort"] !== undefined)) {
    return v.map(asRec).filter((x): x is Rec => !!x);
  }
  return [];
}

/** 리프 값 문자열화 — Property.value, MLP(value[{language,text}]), Range 등. */
function leafValue(el: Rec): string | null {
  const v = el["value"];
  if (v == null) {
    // Range / File 등 다른 필드에 값이 있는 타입
    if (el["min"] !== undefined || el["max"] !== undefined)
      return `${el["min"] ?? "-∞"} … ${el["max"] ?? "+∞"}`;
    return null;
  }
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean")
    return String(v);
  // MultiLanguageProperty: [{ language, text }]
  if (Array.isArray(v) && v.every(x => asRec(x)?.["text"] !== undefined)) {
    return v
      .map(x => {
        const r = asRec(x);
        return r ? `[${r["language"]}] ${r["text"]}` : "";
      })
      .filter(Boolean)
      .join("  ");
  }
  return null;
}

/* ── 재귀 트리 노드 ───────────────────────────────────────────── */

function ElementNode({ el, depth }: { el: Rec; depth: number }) {
  const children = childElements(el);
  const [open, setOpen] = useState(depth < 2); // 얕은 깊이는 기본 펼침
  const idShort = String(el["idShort"] ?? "(idShort 없음)");
  const modelType =
    typeof el["modelType"] === "string"
      ? (el["modelType"] as string)
      : ((asRec(el["modelType"])?.["name"] as string | undefined) ?? "");
  const sem = elementSemanticId(el);
  const recognized = sem ? recognizeSemanticId(sem) : null;
  const value = children.length === 0 ? leafValue(el) : null;

  return (
    <div className={depth > 0 ? "pl-3 border-l border-border/60" : ""}>
      <div className="flex items-start gap-1.5 py-1 min-w-0">
        {children.length > 0 ? (
          <button
            onClick={() => setOpen(o => !o)}
            aria-expanded={open}
            className="mt-0.5 text-muted-foreground hover:text-foreground flex-shrink-0"
          >
            {open ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
          </button>
        ) : (
          <span className="w-3.5 flex-shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-medium text-foreground">
              {idShort}
            </span>
            {modelType && (
              <span className="text-[10px] px-1 py-px rounded bg-muted text-muted-foreground">
                {modelType}
              </span>
            )}
            {recognized && (
              <span className="text-[10px] text-muted-foreground">
                {recognized.name}
              </span>
            )}
            {recognized?.externalUrl && (
              <a
                href={recognized.externalUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="text-muted-foreground hover:text-primary"
                title={sem}
              >
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
          {value !== null && (
            <MonoText className="!text-[11px] !font-normal text-foreground break-all block">
              {value}
            </MonoText>
          )}
          {sem && (
            <MonoText className="!text-[10px] !font-normal text-muted-foreground truncate block">
              {sem}
            </MonoText>
          )}
        </div>
      </div>
      {open &&
        children.map((c, i) => (
          <ElementNode
            key={`${c["idShort"] ?? i}-${i}`}
            el={c}
            depth={depth + 1}
          />
        ))}
    </div>
  );
}

/* ── 다이얼로그 본체 ──────────────────────────────────────────── */

export default function SubmodelContentViewer({
  aasId,
  submodelId,
  idShort,
  onClose,
}: {
  aasId: string;
  submodelId: string;
  idShort: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["submodel-content", aasId, submodelId],
    queryFn: () => fetchSubmodelContent(aasId, submodelId),
    staleTime: 30_000,
    retry: false, // 401/SSRF 거부 등은 재시도해도 같다 — 즉시 안내
  });

  const content = asRec(data?.content);
  const roots = content ? childElements(content) : [];

  // ESC 로 닫기 — 백드롭 클릭 대신 키보드 접근 가능한 닫기 경로(a11y).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t.twins.content.title}
    >
      <div className="bg-card rounded-xl border border-border shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        <div className="flex items-center gap-2 px-5 py-3.5 border-b border-border flex-shrink-0">
          <FileJson className="w-4 h-4 text-primary" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold truncate">
              {t.twins.content.title} — {idShort}
            </div>
            {data?.href && (
              <MonoText className="!text-[10px] !font-normal text-muted-foreground truncate block">
                {data.href}
              </MonoText>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label={t.common.close}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 overflow-y-auto min-h-[120px]">
          {isLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" />
              {t.twins.content.loading}
            </div>
          )}
          {isError && (
            <div className="text-sm text-destructive py-6 text-center">
              {t.twins.content.error}
              <MonoText className="!text-[11px] !font-normal text-muted-foreground block mt-1">
                {(error as Error)?.message ?? ""}
              </MonoText>
            </div>
          )}
          {!isLoading && !isError && roots.length === 0 && (
            <div className="text-sm text-muted-foreground py-6 text-center">
              {t.twins.content.empty}
            </div>
          )}
          {!isLoading &&
            !isError &&
            roots.map((el, i) => (
              <ElementNode
                key={`${el["idShort"] ?? i}-${i}`}
                el={el}
                depth={0}
              />
            ))}
        </div>
      </div>
    </div>
  );
}
