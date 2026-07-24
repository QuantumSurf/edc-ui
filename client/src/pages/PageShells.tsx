// Connector Hub — Digital Twin Registry (Tractus-X DTR)
// Lists Shell Descriptors and supports create/delete; submodels shown inline in detail dialog.

import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import {
  fetchShells,
  createShell,
  updateShell,
  deleteShell,
  fetchShellRaw,
  lookupShells,
} from "@/services";
import type { ShellDescriptor, SpecificAssetId } from "@/lib/data";
import {
  recognizeSemanticId,
  SEMANTIC_TEMPLATES,
} from "@/lib/semanticTemplates";
import { findDuplicates } from "@/lib/descriptorValidation";
import { AlertCircle } from "lucide-react";
import {
  Card,
  Badge,
  MonoText,
  SectionHdr,
  FormField,
  PrimaryActionButton,
  inputBase,
  ListCard,
  ListHeaderRow,
  ListRow,
  ListColLabel,
  ListEmpty,
  ListError,
} from "@/components/ui-kmx";

// 반응형: lg 미만은 중요 컬럼(idShort·AAS ID·서브모델 수)만 유동폭으로 표시하고
// 부차 컬럼(globalAssetId·specificAssetIds)은 hidden lg:block 으로 숨긴다. lg+ 는 전체 5컬럼.
const SHELL_COLS =
  "grid-cols-[minmax(90px,1fr)_minmax(120px,1.4fr)_56px] lg:grid-cols-[1.2fr_1.6fr_1.6fr_1.4fr_0.7fr]";
import { DataTablePagination } from "@/components/DataTablePagination";
import { usePagination } from "@/lib/usePagination";
import {
  SlidePanel,
  InfoCard,
  DetailSection,
  JsonViewerDialog,
  DeleteConfirmDialog,
} from "@/components/DetailDeleteDialogs";
import {
  ExposeSubmodelDialog,
  type ExposeTarget,
} from "@/components/ExposeSubmodelDialog";
import { ExposeDtrDialog } from "@/components/ExposeDtrDialog";
import SubmodelContentViewer from "@/components/SubmodelContentViewer";
import ShellConformancePanel from "@/components/ShellConformancePanel";
import {
  Boxes,
  PlusCircle,
  Trash2,
  Search,
  RefreshCw,
  Loader2,
  X,
  Pencil,
  FileJson,
  BookMarked,
  Share2,
  Lock,
} from "lucide-react";
import { RoleGate } from "@/components/RoleGate";
import { cn } from "@/lib/utils";
import { SubmodelFormFields, EndpointDetail } from "@/components/SubmodelForm";
import {
  type SubmodelInput,
  newSubmodel,
  submodelInputToBody,
  rawSubmodelToInput,
} from "@/lib/submodelDescriptor";
import { toast } from "sonner";

/** semanticId 가 알려진 표준 템플릿이면 사람이 읽는 이름 배지로 표시(Self-Descriptive).
 *  정본 매칭이 아니면(caution) 앰버로 구분해 버전/비정본 드리프트를 눈에 띄게 한다. */
function TemplateBadge({ semanticId }: { semanticId: string }) {
  const rec = recognizeSemanticId(semanticId);
  if (!rec) return null;
  const variant = rec.caution
    ? "amber"
    : rec.source === "Catena-X"
      ? "purple"
      : rec.source === "IRDI"
        ? "gray"
        : "blue";
  return (
    <Badge variant={variant}>
      {rec.name}
      {rec.ref ? ` · ${rec.ref}` : ""}
    </Badge>
  );
}

/* ─── Discovery: specificAssetId 로 셸 찾기 ─────────────────────────
 * AAS Registry & Discovery 표준 경로(POST /lookup/shells)를 UI 로 노출한다.
 * 목록의 텍스트 검색은 '이미 받아온 셸'만 훑지만, 이건 레지스트리에 직접 질의해
 * 자산 식별자로 AAS ID 를 해석한다(탐색 축이 다름). */
function ShellDiscoveryDialog({
  open,
  onClose,
  shells,
  onOpenShell,
}: {
  open: boolean;
  onClose: () => void;
  shells: ShellDescriptor[];
  onOpenShell: (s: ShellDescriptor) => void;
}) {
  const { t } = useI18n();
  const [pairs, setPairs] = useState<SpecificAssetId[]>([
    { name: "", value: "" },
  ]);
  const [result, setResult] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const reset = () => {
    setPairs([{ name: "", value: "" }]);
    setResult(null);
    setError("");
  };
  const close = () => {
    reset();
    onClose();
  };

  const run = async () => {
    const criteria = pairs.filter(p => p.name.trim() && p.value.trim());
    if (criteria.length === 0) {
      setError(t.twins.discovery.needCriteria);
      return;
    }
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const res = await lookupShells(criteria);
      setResult(res.shellIds ?? []);
    } catch (e) {
      setError((e as Error).message || t.twins.discovery.failed);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SlidePanel open={open} onClose={close} className="max-w-lg">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border bg-muted/30 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Search className="w-4 h-4 text-blue-500 flex-shrink-0" />
          <p className="text-[15px] font-semibold text-foreground truncate">
            {t.twins.discovery.title}
          </p>
        </div>
        <button
          onClick={close}
          aria-label={t.common.close}
          className="-mr-1 p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <p className="text-[11px] text-muted-foreground leading-snug">
          {t.twins.discovery.desc}
        </p>

        <div className="space-y-1.5">
          {pairs.map((p, i) => (
            <div key={i} className="flex gap-1.5 items-center">
              <input
                aria-label={`${t.twins.form.keyName} #${i + 1}`}
                placeholder={t.twins.form.keyName}
                value={p.name}
                onChange={e => {
                  const n = [...pairs];
                  n[i] = { ...n[i], name: e.target.value };
                  setPairs(n);
                }}
                className={`${inputBase} flex-1`}
              />
              <input
                aria-label={`${t.twins.form.keyValue} #${i + 1}`}
                placeholder={t.twins.form.keyValue}
                value={p.value}
                onChange={e => {
                  const n = [...pairs];
                  n[i] = { ...n[i], value: e.target.value };
                  setPairs(n);
                }}
                className={`${inputBase} flex-1 mono`}
              />
              <button
                onClick={() => setPairs(pairs.filter((_, j) => j !== i))}
                aria-label={t.common.delete}
                disabled={pairs.length === 1}
                className="text-muted-foreground hover:text-rose-600 disabled:opacity-40 focus:outline-none focus-visible:ring-1 focus-visible:ring-rose-400 rounded"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          <button
            onClick={() => setPairs([...pairs, { name: "", value: "" }])}
            className="text-[11px] text-primary hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded"
          >
            + {t.twins.discovery.addPair}
          </button>
        </div>

        {error && <FieldWarn text={error} />}

        {result !== null && (
          <div className="pt-2 border-t border-border space-y-1.5">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
              {t.twins.discovery.results(result.length)}
            </span>
            {result.length === 0 ? (
              <p className="text-[12px] text-muted-foreground">
                {t.twins.discovery.empty}
              </p>
            ) : (
              <ul className="space-y-1">
                {result.map(id => {
                  const known = shells.find(s => s.id === id);
                  return (
                    <li
                      key={id}
                      className="flex items-center gap-2 rounded border border-border bg-card px-2 py-1.5 min-w-0"
                    >
                      <MonoText className="!text-[11px] !font-normal break-all flex-1 min-w-0">
                        {id}
                      </MonoText>
                      {known && (
                        <button
                          onClick={() => {
                            close();
                            onOpenShell(known);
                          }}
                          className="text-[10px] px-2 py-0.5 rounded border border-border hover:bg-muted text-primary flex-shrink-0 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                        >
                          {t.twins.discovery.inList}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 px-3 py-2.5 border-t border-border bg-muted/20 flex-shrink-0">
        <button
          onClick={close}
          className="px-3 py-1.5 text-[12px] rounded border border-border hover:bg-muted focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
        >
          {t.twins.form.cancel}
        </button>
        <PrimaryActionButton
          onClick={run}
          disabled={loading}
          icon={
            loading ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Search className="w-3 h-3" />
            )
          }
        >
          {loading ? t.twins.discovery.searching : t.twins.discovery.search}
        </PrimaryActionButton>
      </div>
    </SlidePanel>
  );
}

/** 비차단 형식/중복 경고 한 줄(황색). */
function FieldWarn({ text }: { text: string }) {
  return (
    <div className="mt-0.5 flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400">
      <AlertCircle className="w-3 h-3 flex-shrink-0" />
      <span>{text}</span>
    </div>
  );
}

export default function PageShells() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<ShellDescriptor | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ShellDescriptor | null>(
    null
  );
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<"create" | "edit">("create");
  const [editorAasId, setEditorAasId] = useState<string | undefined>(undefined);
  const [jsonView, setJsonView] = useState<ShellDescriptor | null>(null);
  const [exposeTarget, setExposeTarget] = useState<ExposeTarget | null>(null);
  const [exposeDtrOpen, setExposeDtrOpen] = useState(false);
  // 레지스트리 facet — assetKind(Type/Instance) 와 표준 템플릿(semanticId) 기준 탐색.
  const [kindFilter, setKindFilter] = useState("");
  const [templateFilter, setTemplateFilter] = useState("");
  // Registry & Discovery — specificAssetId 로 레지스트리에 직접 질의(목록 검색과 별개 축).
  const [discoveryOpen, setDiscoveryOpen] = useState(false);

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["shells"],
    queryFn: () => fetchShells({ limit: 200 }),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchInterval: false,
  });
  const shells = data?.items ?? [];

  const filtered = shells.filter(s => {
    // 텍스트 검색 — 셸 식별자에 더해 서브모델 semanticId 까지(의미 기반 탐색).
    const q = search.toLowerCase();
    if (q) {
      const hit =
        s.id.toLowerCase().includes(q) ||
        s.idShort.toLowerCase().includes(q) ||
        s.globalAssetId.toLowerCase().includes(q) ||
        s.submodelDescriptors.some(sub =>
          (sub.semanticId ?? "").toLowerCase().includes(q)
        );
      if (!hit) return false;
    }
    // assetKind facet — Type(형식) ↔ Instance(개체) 구분 탐색.
    if (kindFilter && s.assetKind !== kindFilter) return false;
    // 표준 템플릿 facet — 이 셸이 해당 의미의 서브모델을 가졌는지.
    if (templateFilter) {
      const sems = s.submodelDescriptors.map(sub => sub.semanticId ?? "");
      if (templateFilter === "__none__") {
        if (!sems.some(v => !v)) return false;
      } else if (templateFilter === "__unknown__") {
        if (!sems.some(v => !!v && !recognizeSemanticId(v))) return false;
      } else {
        // 정본 정확일치 또는 같은 계열(ref 동일 — 버전 달라도 포함)
        const target = recognizeSemanticId(templateFilter);
        const match = sems.some(v => {
          if (!v) return false;
          if (v === templateFilter) return true;
          const r = recognizeSemanticId(v);
          return !!r?.ref && !!target?.ref && r.ref === target.ref;
        });
        if (!match) return false;
      }
    }
    return true;
  });

  const {
    paginatedData,
    totalItems,
    currentPage,
    pageSize,
    setCurrentPage,
    setPageSize,
  } = usePagination(filtered, 10);

  return (
    <>
      <SectionHdr
        icon={<BookMarked className="w-5 h-5 text-primary" />}
        subtitle={t.pageSubtitles.shells}
        action={
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded border border-border hover:bg-muted disabled:opacity-50 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
            >
              <RefreshCw
                className={`w-3 h-3 ${isFetching ? "animate-spin" : ""}`}
              />
              {t.twins.refresh}
            </button>
            {/* 디스커버리 — 조회 기능이라 역할 게이팅 없음 */}
            <button
              onClick={() => setDiscoveryOpen(true)}
              className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded border border-border hover:bg-muted focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
            >
              <Search className="w-3 h-3" />
              {t.twins.discovery.action}
            </button>
            <RoleGate permission="resource:write">
              <button
                onClick={() => setExposeDtrOpen(true)}
                className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded border border-border hover:bg-muted text-foreground font-medium focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
              >
                <Share2 className="w-3 h-3" />
                {t.twins.exposeDtr.action}
              </button>
              <PrimaryActionButton
                onClick={() => {
                  setEditorMode("create");
                  setEditorAasId(undefined);
                  setEditorOpen(true);
                }}
                icon={<PlusCircle className="w-3 h-3" />}
              >
                {t.twins.create}
              </PrimaryActionButton>
            </RoleGate>
          </div>
        }
      >
        {t.twins.title}
      </SectionHdr>

      {/* Search & Filter — 검색을 카드에 그룹화 (목록 페이지와 통일) */}
      <div className="flex flex-col sm:flex-row gap-3 flex-wrap bg-card border border-border rounded-xl px-4 py-3 shadow-sm">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder={t.twins.searchPlaceholder}
            value={search}
            onChange={e => {
              setSearch(e.target.value);
              setCurrentPage(1);
            }}
            aria-label={t.twins.searchPlaceholder}
            className={`${inputBase} pl-8 !bg-background`}
          />
        </div>
        {/* facet — Type/Instance 구분 탐색(1 Type → N Instance 온보딩 모델) */}
        <select
          value={kindFilter}
          onChange={e => {
            setKindFilter(e.target.value);
            setCurrentPage(1);
          }}
          aria-label={t.twins.filter.assetKind}
          className={`${inputBase} !bg-background w-auto min-w-[130px]`}
        >
          <option value="">{t.twins.filter.allKinds}</option>
          <option value="Type">Type</option>
          <option value="Instance">Instance</option>
          <option value="NotApplicable">NotApplicable</option>
        </select>
        {/* facet — 표준 템플릿(semanticId) 기준 의미 탐색 */}
        <select
          value={templateFilter}
          onChange={e => {
            setTemplateFilter(e.target.value);
            setCurrentPage(1);
          }}
          aria-label={t.twins.filter.template}
          className={`${inputBase} !bg-background w-auto min-w-[190px]`}
        >
          <option value="">{t.twins.filter.allTemplates}</option>
          {SEMANTIC_TEMPLATES.map(tpl => (
            <option key={tpl.semanticId} value={tpl.semanticId}>
              {tpl.name}
            </option>
          ))}
          <option value="__unknown__">{t.twins.filter.unrecognized}</option>
          <option value="__none__">{t.twins.filter.noSemanticId}</option>
        </select>
      </div>

      {/* Loading */}
      {isLoading && (
        <Card>
          <div className="flex items-center justify-center py-10 gap-2 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-[13px]">{t.common.loading}</span>
          </div>
        </Card>
      )}

      {/* Error */}
      {!isLoading && isError && (
        <Card>
          <ListError onRetry={() => refetch()} fetching={isFetching} />
        </Card>
      )}

      {/* Empty */}
      {!isLoading && !isError && shells.length === 0 && (
        <Card>
          <ListEmpty icon={<Boxes />} message={t.twins.empty} />
        </Card>
      )}

      {/* List — fl-aggregator ListCard */}
      {!isLoading && !isError && shells.length > 0 && (
        <ListCard title={t.twins.listTitle} responsive>
          <ListHeaderRow cols={SHELL_COLS}>
            <ListColLabel>{t.twins.col.idShort}</ListColLabel>
            <ListColLabel>{t.twins.col.aasId}</ListColLabel>
            <ListColLabel className="hidden lg:block">
              {t.twins.col.globalAssetId}
            </ListColLabel>
            <ListColLabel className="hidden lg:block">
              {t.twins.col.specificAssetIds}
            </ListColLabel>
            <ListColLabel>{t.twins.col.submodels}</ListColLabel>
          </ListHeaderRow>
          {filtered.length === 0 ? (
            <ListEmpty icon={<Boxes />} message={t.twins.noSearchResults} />
          ) : (
            paginatedData.map(s => (
              <ListRow
                key={s.id}
                cols={SHELL_COLS}
                selected={detail?.id === s.id}
                onClick={() => setDetail(s)}
              >
                <div className="min-w-0">
                  <span className="text-xs font-bold text-primary truncate block">
                    {s.idShort || "—"}
                  </span>
                </div>
                <div className="min-w-0">
                  <span className="text-xs text-foreground truncate block">
                    {s.id}
                  </span>
                </div>
                <div className="hidden lg:block min-w-0">
                  <span className="text-xs text-foreground truncate block">
                    {s.globalAssetId || "—"}
                  </span>
                </div>
                {/* overflow-hidden: min-w-min 래퍼 전환 후 fr 배분폭보다 배지 합이 크면
                    인접 컬럼(서브모델 수) 위로 겹쳐 그려지는 회귀 방지 — 넘치면 말줄임. */}
                <div className="hidden lg:block min-w-0 overflow-hidden">
                  <div className="flex items-center gap-1 min-w-0">
                    {s.specificAssetIds.slice(0, 2).map((sa, i) => (
                      <Badge
                        key={i}
                        variant="gray"
                        className="min-w-0 overflow-hidden"
                      >
                        <span className="truncate">
                          {sa.name}={sa.value}
                        </span>
                      </Badge>
                    ))}
                    {s.specificAssetIds.length > 2 && (
                      <span className="text-[10px] text-muted-foreground flex-shrink-0">
                        +{s.specificAssetIds.length - 2}
                      </span>
                    )}
                  </div>
                </div>
                <div>
                  <Badge variant={s.submodelCount > 0 ? "blue" : "gray"}>
                    {s.submodelCount}
                  </Badge>
                </div>
              </ListRow>
            ))
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
        </ListCard>
      )}

      {/* Detail dialog */}
      <ShellDetailDialog
        shell={detail}
        onClose={() => setDetail(null)}
        onEdit={() => {
          if (detail) {
            setEditorMode("edit");
            setEditorAasId(detail.id);
            setEditorOpen(true);
            setDetail(null);
          }
        }}
        onDelete={() => {
          setDeleteTarget(detail);
          setDetail(null);
        }}
        onViewJson={() => {
          if (detail) {
            setJsonView(detail);
            setDetail(null);
          }
        }}
        onExpose={tgt => setExposeTarget(tgt)}
      />

      {/* Expose submodel to catalog */}
      <ExposeSubmodelDialog
        target={exposeTarget}
        onClose={() => setExposeTarget(null)}
        onDone={cid => {
          qc.invalidateQueries({ queryKey: ["shells"] });
          // 노출 직후 해당 커넥터의 자산·계약정의 목록·사이드바 카운트 갱신(id 37).
          qc.invalidateQueries({ queryKey: ["assets", cid] });
          qc.invalidateQueries({ queryKey: ["offerings", cid] });
        }}
      />

      {/* Expose the DTR itself to catalog */}
      <ExposeDtrDialog
        open={exposeDtrOpen}
        onClose={() => setExposeDtrOpen(false)}
        onDone={cid => {
          // registry list unchanged; asset/offering created on connector (id 37).
          qc.invalidateQueries({ queryKey: ["assets", cid] });
          qc.invalidateQueries({ queryKey: ["offerings", cid] });
        }}
      />

      {/* JSON view dialog */}
      <ShellJsonDialog shell={jsonView} onClose={() => setJsonView(null)} />

      {/* Discovery (specificAssetId → AAS ID) */}
      <ShellDiscoveryDialog
        open={discoveryOpen}
        onClose={() => setDiscoveryOpen(false)}
        shells={shells}
        onOpenShell={s => setDetail(s)}
      />

      {/* Create dialog */}
      <ShellEditorDialog
        open={editorOpen}
        mode={editorMode}
        initialAasId={editorAasId}
        existingAasIds={shells.map(s => s.id)}
        onClose={() => setEditorOpen(false)}
        onSaved={() => {
          setEditorOpen(false);
          qc.invalidateQueries({ queryKey: ["shells"] });
        }}
      />

      {/* Delete confirm */}
      <DeleteConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        itemName={deleteTarget?.idShort ?? deleteTarget?.id ?? ""}
        subtitle={deleteTarget?.id}
        onConfirm={async () => {
          if (deleteTarget) await deleteShell(deleteTarget.id);
        }}
        queryKeys={[["shells"]]}
        successMessage={
          deleteTarget ? t.twins.msg.deleted(deleteTarget.idShort) : undefined
        }
      />
    </>
  );
}

/* ─── Detail dialog ──────────────────────────────────────────── */
function ShellDetailDialog({
  shell,
  onClose,
  onEdit,
  onDelete,
  onViewJson,
  onExpose,
}: {
  shell: ShellDescriptor | null;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onViewJson: () => void;
  onExpose: (target: ExposeTarget) => void;
}) {
  // 서브모델 실본문 뷰어 — 열려 있는 대상(null=닫힘).
  const [contentTarget, setContentTarget] = useState<{
    submodelId: string;
    idShort: string;
  } | null>(null);
  const { t } = useI18n();
  if (!shell) return null;
  const copy = (s: string) => {
    navigator.clipboard.writeText(s);
    toast.success(t.common.copied);
  };
  return (
    <SlidePanel open={!!shell} onClose={onClose} className="sm:max-w-2xl">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2 flex-wrap pr-8">
          <BookMarked className="w-4 h-4 text-primary flex-shrink-0" />
          <h2 className="text-[15px] font-semibold text-foreground truncate">
            {shell.idShort || t.twins.detail.title}
          </h2>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto p-5 space-y-5 text-xs">
        {/* 기본 정보 */}
        <DetailSection title={t.twins.detail.title}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <InfoCard
              label={t.twins.col.aasId}
              value={shell.id}
              span
              mono
              copyable={shell.id}
            />
            <InfoCard
              label={t.twins.col.globalAssetId}
              value={shell.globalAssetId}
              span
              mono
              copyable={shell.globalAssetId || undefined}
            />
            {shell.assetKind && (
              <InfoCard
                label={t.twins.form.assetKind}
                value={shell.assetKind}
              />
            )}
            {shell.version && (
              <InfoCard
                label="Version"
                value={`${shell.version}${shell.revision ? `.${shell.revision}` : ""}`}
              />
            )}
          </div>
        </DetailSection>

        {/* 설명 */}
        {(shell.descriptions ?? []).length > 0 && (
          <DetailSection title={t.twins.form.description}>
            <div className="space-y-1.5">
              {(shell.descriptions ?? []).map((d, i) => (
                <div key={i} className="flex items-start gap-2">
                  <Badge variant="gray">{d.language || "—"}</Badge>
                  <span className="flex-1 break-words text-foreground">
                    {d.text}
                  </span>
                </div>
              ))}
            </div>
          </DetailSection>
        )}

        {/* specificAssetIds */}
        <DetailSection title={t.twins.col.specificAssetIds}>
          {shell.specificAssetIds.length === 0 ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <div className="flex flex-wrap gap-1">
              {shell.specificAssetIds.map((sa, i) => (
                <Badge key={i} variant="gray">
                  {sa.name}={sa.value}
                </Badge>
              ))}
            </div>
          )}
        </DetailSection>

        {/* Submodels */}
        <DetailSection title={t.twins.detail.submodels}>
          {shell.submodelDescriptors.length === 0 ? (
            <span className="text-muted-foreground">
              {t.twins.detail.noSubmodels}
            </span>
          ) : (
            <ul className="space-y-2 min-w-0">
              {shell.submodelDescriptors.map(sub => (
                <li
                  key={sub.id}
                  className="bg-muted/30 rounded-lg border border-border p-3 space-y-2 min-w-0 overflow-hidden"
                >
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-foreground">
                        {sub.idShort}
                      </div>
                      <MonoText className="!text-[11px] !font-normal text-muted-foreground truncate block">
                        {sub.id}
                      </MonoText>
                      {sub.semanticId && (
                        <MonoText className="!text-[11px] !font-normal text-muted-foreground truncate block">
                          semanticId: {sub.semanticId}
                        </MonoText>
                      )}
                      {(sub.semanticId ||
                        (sub.supplementalSemanticIds ?? []).length > 0 ||
                        sub.version) && (
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          {sub.semanticId && (
                            <TemplateBadge semanticId={sub.semanticId} />
                          )}
                          {/* 보조 semanticId — 표준 템플릿에 의미를 덧붙인 확장 */}
                          {(sub.supplementalSemanticIds ?? []).map(sid => (
                            <TemplateBadge key={sid} semanticId={sid} />
                          ))}
                          {/* AdministrativeInformation — 템플릿 버전/리비전 */}
                          {sub.version && (
                            <span className="text-[10px] text-muted-foreground">
                              v{sub.version}
                              {sub.revision ? `.${sub.revision}` : ""}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <Badge variant="blue">{sub.endpointCount} ep</Badge>
                      {sub.endpointCount > 0 && (
                        <button
                          onClick={() =>
                            setContentTarget({
                              submodelId: sub.id,
                              idShort: sub.idShort,
                            })
                          }
                          className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border border-border hover:bg-muted text-muted-foreground hover:text-foreground"
                        >
                          <FileJson className="w-3 h-3" />
                          {t.twins.content.view}
                        </button>
                      )}
                      <RoleGate permission="resource:write">
                        <button
                          onClick={() =>
                            onExpose({
                              aasId: shell.id,
                              submodelId: sub.id,
                              idShort: sub.idShort,
                              semanticId: sub.semanticId,
                            })
                          }
                          className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border border-border hover:bg-muted text-muted-foreground hover:text-foreground"
                        >
                          <Share2 className="w-3 h-3" />
                          {t.twins.expose.action}
                        </button>
                      </RoleGate>
                    </div>
                  </div>
                  {(sub.endpoints ?? []).length > 0 && (
                    <div className="space-y-1.5 pl-2 border-l-2 border-violet-300 dark:border-violet-500/40">
                      {(sub.endpoints ?? []).map((ep, ei) => (
                        <EndpointDetail
                          key={ei}
                          ep={ep}
                          index={ei}
                          onCopy={copy}
                        />
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </DetailSection>

        {/* 표준 적합성 — 디스크립터 레벨 종합 판정(비차단) */}
        <DetailSection title={t.twins.conformance.title}>
          <ShellConformancePanel shell={shell} />
        </DetailSection>
      </div>

      {contentTarget && (
        <SubmodelContentViewer
          aasId={shell.id}
          submodelId={contentTarget.submodelId}
          idShort={contentTarget.idShort}
          onClose={() => setContentTarget(null)}
        />
      )}

      {/* Footer */}
      <div className="px-5 py-4 bg-muted/30 border-t border-border flex items-center gap-2 flex-shrink-0">
        <button
          onClick={onViewJson}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground rounded-md transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
        >
          <FileJson size={13} /> {t.twins.detail.viewJson}
        </button>
        <div className="flex-1" />
        <RoleGate permission="resource:write">
          <button
            onClick={onEdit}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground rounded-md transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
          >
            <Pencil size={13} /> {t.common.edit}
          </button>
          <button
            onClick={onDelete}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-md transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-rose-400"
          >
            <Trash2 size={13} /> {t.common.delete}
          </button>
        </RoleGate>
        <button
          onClick={onClose}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium border border-border text-foreground rounded-md hover:bg-muted transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
        >
          <X size={13} /> {t.common.close}
        </button>
      </div>
    </SlidePanel>
  );
}

/* ─── JSON view dialog ───────────────────────────────────────── */
function ShellJsonDialog({
  shell,
  onClose,
}: {
  shell: ShellDescriptor | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [raw, setRaw] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!shell) {
      setRaw(null);
      return;
    }
    setLoading(true);
    fetchShellRaw(shell.id)
      .then(data => setRaw(data))
      .catch(e => toast.error((e as Error).message))
      .finally(() => setLoading(false));
  }, [shell]);

  if (!shell) return null;
  // 공용 JsonViewerDialog로 위임(트리/원문 토글·모두 펼치기/접기·검색·복사 피드백 공통 제공)
  return (
    <JsonViewerDialog
      open={!!shell}
      onClose={onClose}
      loading={loading}
      title={t.twins.detail.jsonTitle}
      subtitle={shell.id}
      json={raw ? JSON.stringify(raw, null, 2) : ""}
      downloadName={shell.idShort || "shell"}
    />
  );
}

/** Convert a raw DTR shell payload back into editor state. */
function rawToEditorState(raw: Record<string, unknown>) {
  const desc =
    (raw.description as Array<{ language?: string; text?: string }>) ?? [];
  const findByLang = (langs: string[]): string => {
    for (const l of langs) {
      const m = desc.find(d => (d.language ?? "").toLowerCase().startsWith(l));
      if (m?.text) return m.text;
    }
    return "";
  };
  const specsRaw =
    (raw.specificAssetIds as Array<Record<string, unknown>>) ?? [];
  const subsRaw =
    (raw.submodelDescriptors as Array<Record<string, unknown>>) ?? [];
  return {
    aasId: (raw.id as string) ?? "",
    idShort: (raw.idShort as string) ?? "",
    globalAssetId: (raw.globalAssetId as string) ?? "",
    assetKind: (raw.assetKind as string) ?? "",
    descriptionKo: findByLang(["ko"]),
    descriptionEn: findByLang(["en"]),
    specs: specsRaw.map(s => ({
      name: (s.name as string) ?? "",
      value: (s.value as string) ?? "",
    })),
    subs: subsRaw.map(s => rawSubmodelToInput(s)),
    // DTR PUT은 전체교체라 비모델링 필드(administration·displayName·assetKind
    // ·extensions 등)가 소실된다. raw 전체를 보존해 submit 시 머지(id 39).
    raw,
    // ko/en 외 언어 description 항목 — 편집값으로 덮어쓰지 않고 carry-over(id 40).
    descriptionRaw: desc.filter(d => {
      const l = (d.language ?? "").toLowerCase();
      return !l.startsWith("ko") && !l.startsWith("en");
    }),
  };
}

/* ─── Editor dialog (create + edit) ─────────────────────── */
function ShellEditorDialog({
  open,
  mode,
  initialAasId,
  onClose,
  onSaved,
  existingAasIds = [],
}: {
  open: boolean;
  mode: "create" | "edit";
  initialAasId?: string;
  onClose: () => void;
  onSaved: () => void;
  /** 이미 등록된 AAS ID 목록 — 생성 시 중복 사전경고용(비차단). */
  existingAasIds?: string[];
}) {
  const { t } = useI18n();
  const [idShort, setIdShort] = useState("");
  const [aasId, setAasId] = useState("");
  const [globalAssetId, setGlobalAssetId] = useState("");
  const [assetKind, setAssetKind] = useState("");
  const [descriptionKo, setDescriptionKo] = useState("");
  const [descriptionEn, setDescriptionEn] = useState("");
  const [specs, setSpecs] = useState<SpecificAssetId[]>([]);
  const [subs, setSubs] = useState<SubmodelInput[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(false);
  // 편집 시작 시 받은 raw 스냅샷·비-ko/en description 보존(id 39/40).
  const [rawSnapshot, setRawSnapshot] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [descriptionRaw, setDescriptionRaw] = useState<
    Array<{ language?: string; text?: string }>
  >([]);

  // 형제 서브모델 간 idShort/id 중복 검출(비차단 경고). AAS 는 동일 레벨 idShort 중복을
  // 금지하고 descriptor id 는 고유해야 하므로, 저장 전에 눈에 띄게 알린다.
  const dupIdShorts = findDuplicates(subs.map(s => s.idShort));
  const dupIds = findDuplicates(subs.map(s => s.id));

  const reset = () => {
    setIdShort("");
    setAasId("");
    setGlobalAssetId("");
    setAssetKind("");
    setDescriptionKo("");
    setDescriptionEn("");
    setSpecs([]);
    setSubs([]);
    setRawSnapshot(null);
    setDescriptionRaw([]);
  };

  // Pre-fill on edit-mode open
  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && initialAasId) {
      setLoading(true);
      fetchShellRaw(initialAasId)
        .then(raw => {
          if (!raw) {
            toast.error(t.twins.msg.loadFailed);
            return;
          }
          const s = rawToEditorState(raw);
          setIdShort(s.idShort);
          setAasId(s.aasId);
          setGlobalAssetId(s.globalAssetId);
          setAssetKind(s.assetKind);
          setDescriptionKo(s.descriptionKo);
          setDescriptionEn(s.descriptionEn);
          setSpecs(s.specs);
          setSubs(s.subs.length > 0 ? s.subs : []);
          setRawSnapshot(s.raw);
          setDescriptionRaw(s.descriptionRaw);
        })
        .finally(() => setLoading(false));
    } else {
      reset();
    }
    // 편집 대상이 바뀔 때만 원본을 다시 불러오는 효과다. t(i18n)를 deps 에 넣으면 언어를
    // 바꾸는 순간 재fetch + 폼 리셋이 일어나 편집 중이던 내용이 사라진다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, initialAasId]);

  const submit = async () => {
    if (!aasId || !idShort) {
      toast.error(t.twins.msg.requiredAasId);
      return;
    }
    for (const s of subs) {
      if (!s.id || !s.idShort) {
        toast.error(t.twins.msg.requiredSubmodel);
        return;
      }
      for (const ep of s.endpoints) {
        if (!ep.protocolInformation.href) {
          toast.error(t.twins.msg.requiredEndpointHref);
          return;
        }
      }
    }
    setSubmitting(true);
    try {
      // DTR PUT은 전체교체라 edit 시 raw를 base로 머지해 비모델링 필드를
      // 보존한다(id 39). create 모드는 raw가 없으므로 빈 base.
      const body: Record<string, unknown> = {
        ...(mode === "edit" && rawSnapshot ? rawSnapshot : {}),
        id: aasId,
        idShort,
        globalAssetId,
        specificAssetIds: specs.filter(s => s.name && s.value),
        submodelDescriptors: subs.map(submodelInputToBody),
      };
      // AAS 표준 assetKind — 선택 시 반영, 비우면 raw carry-over 제거(사용자 삭제 의도).
      if (assetKind) body.assetKind = assetKind;
      else delete body.assetKind;
      // ko/en 편집값 + 보존된 비-ko/en 언어 항목 머지(id 40).
      const descriptions: Array<{ language?: string; text?: string }> = [
        ...descriptionRaw,
      ];
      if (descriptionKo)
        descriptions.push({ language: "ko", text: descriptionKo });
      if (descriptionEn)
        descriptions.push({ language: "en", text: descriptionEn });
      if (descriptions.length > 0) {
        body.description = descriptions;
      } else {
        // 모든 언어가 비었으면 raw에서 가져온 description 키를 남기지 않는다.
        delete body.description;
      }
      if (mode === "edit") {
        await updateShell(initialAasId!, body);
        toast.success(t.twins.msg.updated(idShort));
      } else {
        await createShell(body);
        toast.success(t.twins.msg.created(idShort));
      }
      reset();
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SlidePanel
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      className="max-w-xl"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border bg-muted/30 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <PlusCircle className="w-4 h-4 text-blue-500 flex-shrink-0" />
          <p className="text-[15px] font-semibold text-foreground truncate">
            {mode === "edit" ? t.twins.edit : t.twins.create}
          </p>
        </div>
        <button
          onClick={() => {
            reset();
            onClose();
          }}
          className="-mr-1 p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
          aria-label={t.common.close}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Body */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center py-10 gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-[13px]">{t.common.loading}</span>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {/* Asset Administration Shell Descriptor */}
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold border-b border-border pb-1">
            Asset Administration Shell Descriptor
          </div>
          <FormField label={t.twins.form.idShort} required>
            <input
              value={idShort}
              onChange={e => setIdShort(e.target.value)}
              placeholder="MyShell"
              className={inputBase}
            />
          </FormField>
          <FormField
            label={t.twins.form.aasId}
            required
            hint={mode === "edit" ? t.twins.aasIdImmutable : undefined}
          >
            <div className="relative">
              {mode === "edit" && (
                <Lock className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              )}
              <input
                value={aasId}
                onChange={e => setAasId(e.target.value)}
                placeholder="urn:uuid:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                disabled={mode === "edit"}
                className={cn(inputBase, "mono", mode === "edit" && "pl-8")}
              />
            </div>
            {/* 고유성 사전경고 — 이미 등록된 AAS ID 면 저장 전에 알린다(비차단) */}
            {mode === "create" &&
              !!aasId.trim() &&
              existingAasIds.includes(aasId.trim()) && (
                <FieldWarn text={t.twins.form.duplicateAasId} />
              )}
          </FormField>
          <FormField label={t.twins.form.globalAssetId}>
            <input
              value={globalAssetId}
              onChange={e => setGlobalAssetId(e.target.value)}
              placeholder="urn:uuid:..."
              className={`${inputBase} mono`}
            />
          </FormField>
          <FormField
            label={t.twins.form.assetKind}
            hint={t.twins.form.assetKindHint}
          >
            <select
              value={assetKind}
              onChange={e => setAssetKind(e.target.value)}
              className={inputBase}
            >
              <option value="">—</option>
              <option value="Instance">Instance</option>
              <option value="Type">Type</option>
              <option value="NotApplicable">NotApplicable</option>
            </select>
          </FormField>
          <FormField label={t.twins.form.descriptionKo}>
            <input
              value={descriptionKo}
              onChange={e => setDescriptionKo(e.target.value)}
              lang="ko"
              className={inputBase}
            />
          </FormField>
          <FormField label={t.twins.form.descriptionEn}>
            <input
              value={descriptionEn}
              onChange={e => setDescriptionEn(e.target.value)}
              lang="en"
              className={inputBase}
            />
          </FormField>

          {/* Specific AssetId[] */}
          <div className="pt-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
                Specific AssetId
              </span>
              <button
                onClick={() => setSpecs([...specs, { name: "", value: "" }])}
                className="text-[11px] text-primary hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded"
              >
                + {t.twins.form.addSpecificAssetId}
              </button>
            </div>
            <div className="space-y-1.5">
              {specs.map((s, i) => (
                <div key={i} className="flex gap-1.5 items-center">
                  <input
                    placeholder={t.twins.form.keyName}
                    aria-label={`${t.twins.form.keyName} #${i + 1}`}
                    value={s.name}
                    onChange={e => {
                      const n = [...specs];
                      n[i] = { ...n[i], name: e.target.value };
                      setSpecs(n);
                    }}
                    className={`${inputBase} flex-1 !text-[11px] !py-1`}
                  />
                  <input
                    placeholder={t.twins.form.keyValue}
                    aria-label={`${t.twins.form.keyValue} #${i + 1}`}
                    value={s.value}
                    onChange={e => {
                      const n = [...specs];
                      n[i] = { ...n[i], value: e.target.value };
                      setSpecs(n);
                    }}
                    className={`${inputBase} flex-1 !text-[11px] !py-1`}
                  />
                  <button
                    onClick={() => setSpecs(specs.filter((_, j) => j !== i))}
                    aria-label={t.common.delete}
                    className="text-muted-foreground hover:text-rose-600 focus:outline-none focus-visible:ring-1 focus-visible:ring-rose-400 rounded"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Submodel Descriptor[] */}
          <div className="pt-2 border-t border-border">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
                Submodel Descriptor
              </span>
              <button
                onClick={() => setSubs([...subs, newSubmodel()])}
                className="text-[11px] text-primary hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded"
              >
                + {t.twins.form.addSubmodel}
              </button>
            </div>
            <div className="space-y-3">
              {subs.map((s, si) => (
                <SubmodelFormFields
                  key={si}
                  submodel={s}
                  index={si}
                  showDescription={false}
                  duplicateIdShort={
                    !!s.idShort.trim() && dupIdShorts.has(s.idShort.trim())
                  }
                  duplicateId={!!s.id.trim() && dupIds.has(s.id.trim())}
                  onChange={next => {
                    const n = [...subs];
                    n[si] = next;
                    setSubs(n);
                  }}
                  onRemove={() => setSubs(subs.filter((_, j) => j !== si))}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="flex justify-end gap-2 px-3 py-2.5 border-t border-border bg-muted/20 flex-shrink-0">
        <button
          onClick={() => {
            reset();
            onClose();
          }}
          className="text-[12px] px-3 py-1.5 rounded border border-border hover:bg-muted focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
        >
          {t.twins.form.cancel}
        </button>
        <PrimaryActionButton
          onClick={submit}
          disabled={submitting || loading}
          icon={
            submitting ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : undefined
          }
        >
          {mode === "edit" ? t.twins.form.update : t.twins.form.submit}
        </PrimaryActionButton>
      </div>
    </SlidePanel>
  );
}
