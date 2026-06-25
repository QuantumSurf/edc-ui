// Connector Hub — Semantic Models (Tractus-X SAMM, local Postgres CRUD)

import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import {
  fetchSemanticModels,
  fetchSemanticModel,
  createSemanticModel,
  updateSemanticModel,
  deleteSemanticModel,
} from "@/services";
import type {
  SemanticModel,
  SemanticModelStatus,
  SemanticModelSummary,
} from "@/lib/data";
import {
  Card,
  Badge,
  SectionHdr,
  FormField,
  PrimaryActionButton,
  inputBase,
  ListCard,
  ListHeaderRow,
  ListRow,
  ListEmpty,
  ListError,
  SortHeader,
  useTableSort,
  sortRows,
} from "@/components/ui-kmx";

const SUBMODEL_COLS = "grid-cols-[1.4fr_2fr_0.7fr_0.9fr_0.9fr_0.7fr_1.1fr]";
import {
  DataTablePagination,
  usePagination,
} from "@/components/DataTablePagination";
import {
  SlidePanel,
  InfoCard,
  DetailSection,
  DeleteConfirmDialog,
} from "@/components/DetailDeleteDialogs";
import { RoleGate } from "@/components/RoleGate";
import { cn } from "@/lib/utils";
import { SammTree } from "@/components/SammTree";
import { parseSammAspect } from "@/lib/samm";
import {
  Layers,
  Search,
  RefreshCw,
  Loader2,
  AlertCircle,
  CheckCircle2,
  PlusCircle,
  Pencil,
  Trash2,
  Copy,
  Download,
  Shapes,
  X,
  Lock,
} from "lucide-react";
import { toast } from "sonner";

const STATUSES: SemanticModelStatus[] = [
  "DRAFT",
  "RELEASED",
  "STANDARDIZED",
  "DEPRECATED",
];
const STATUS_VARIANT: Record<
  SemanticModelStatus,
  "gray" | "blue" | "green" | "amber"
> = {
  DRAFT: "gray",
  RELEASED: "blue",
  STANDARDIZED: "green",
  DEPRECATED: "amber",
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string, locale: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString(locale === "ko" ? "ko-KR" : "en-US");
}

export default function PageSubmodels() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [detailUrn, setDetailUrn] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SemanticModelSummary | null>(
    null
  );
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<"create" | "edit">("create");
  const [editorUrn, setEditorUrn] = useState<string | null>(null);

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["semantic-models"],
    queryFn: () => fetchSemanticModels(),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchInterval: false,
  });
  const items = data?.items ?? [];

  const filtered = useMemo(
    () =>
      items.filter(m => {
        const q = search.toLowerCase();
        if (!q) return true;
        return (
          m.urn.toLowerCase().includes(q) ||
          m.name.toLowerCase().includes(q) ||
          (m.descriptionKo ?? "").toLowerCase().includes(q) ||
          (m.descriptionEn ?? "").toLowerCase().includes(q)
        );
      }),
    [items, search]
  );

  // 컬럼 헤더 클릭 정렬 (기본: 수정일 최신순)
  const { sortKey, sortDir, toggleSort } = useTableSort("updatedAt", "desc");
  const sorted = useMemo(
    () =>
      sortRows(filtered, sortKey, sortDir, (m, k) => {
        switch (k) {
          case "name":
            return m.name;
          case "urn":
            return m.urn;
          case "version":
            return m.version;
          case "status":
            return m.status;
          case "modelType":
            return m.modelType;
          case "size":
            return m.contentBytes;
          case "updatedAt":
            return new Date(m.updatedAt).getTime();
          default:
            return undefined;
        }
      }),
    [filtered, sortKey, sortDir]
  );

  const {
    paginatedData,
    totalItems,
    currentPage,
    pageSize,
    setCurrentPage,
    setPageSize,
  } = usePagination(sorted, 10);

  // 정렬 변경 시 1페이지로
  useEffect(() => {
    setCurrentPage(1);
  }, [sortKey, sortDir, setCurrentPage]);

  return (
    <>
      <SectionHdr
        icon={<Shapes className="w-5 h-5 text-primary" />}
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
              {t.submodels.refresh}
            </button>
            <RoleGate permission="resource:write">
              <PrimaryActionButton
                onClick={() => {
                  setEditorMode("create");
                  setEditorUrn(null);
                  setEditorOpen(true);
                }}
                icon={<PlusCircle className="w-3 h-3" />}
              >
                {t.submodels.create}
              </PrimaryActionButton>
            </RoleGate>
          </div>
        }
      >
        {t.submodels.title}
      </SectionHdr>

      {/* Search & Filter — fl-aggregator TasksPage style */}
      <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder={t.submodels.searchPlaceholder}
            value={search}
            onChange={e => {
              setSearch(e.target.value);
              setCurrentPage(1);
            }}
            aria-label={t.submodels.searchPlaceholder}
            className={`${inputBase} pl-8`}
          />
        </div>
      </div>

      {isLoading && (
        <Card>
          <div className="flex items-center justify-center py-10 gap-2 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-[13px]">{t.common.loading}</span>
          </div>
        </Card>
      )}

      {!isLoading && isError && (
        <Card>
          <ListError onRetry={() => refetch()} fetching={isFetching} />
        </Card>
      )}

      {!isLoading && !isError && items.length === 0 && (
        <Card>
          <ListEmpty icon={<Layers />} message={t.submodels.empty} />
        </Card>
      )}

      {!isLoading && !isError && items.length > 0 && (
        <ListCard title={t.submodels.listTitle}>
          <ListHeaderRow cols={SUBMODEL_COLS}>
            <SortHeader
              label={t.submodels.col.name}
              columnKey="name"
              activeKey={sortKey}
              dir={sortDir}
              onSort={toggleSort}
            />
            <SortHeader
              label={t.submodels.col.urn}
              columnKey="urn"
              activeKey={sortKey}
              dir={sortDir}
              onSort={toggleSort}
            />
            <SortHeader
              label={t.submodels.col.version}
              columnKey="version"
              activeKey={sortKey}
              dir={sortDir}
              onSort={toggleSort}
            />
            <SortHeader
              label={t.submodels.col.status}
              columnKey="status"
              activeKey={sortKey}
              dir={sortDir}
              onSort={toggleSort}
            />
            <SortHeader
              label={t.submodels.col.modelType}
              columnKey="modelType"
              activeKey={sortKey}
              dir={sortDir}
              onSort={toggleSort}
              className="hidden lg:inline-flex"
            />
            <SortHeader
              label={t.submodels.col.size}
              columnKey="size"
              activeKey={sortKey}
              dir={sortDir}
              onSort={toggleSort}
              className="hidden xl:inline-flex"
            />
            <SortHeader
              label={t.submodels.col.updated}
              columnKey="updatedAt"
              activeKey={sortKey}
              dir={sortDir}
              onSort={toggleSort}
              className="hidden xl:inline-flex"
            />
          </ListHeaderRow>
          {filtered.length === 0 ? (
            <ListEmpty
              icon={<Layers />}
              message={t.submodels.noSearchResults}
            />
          ) : (
            paginatedData.map(m => (
              <ListRow
                key={m.urn}
                cols={SUBMODEL_COLS}
                selected={detailUrn === m.urn}
                onClick={() => setDetailUrn(m.urn)}
              >
                <div className="min-w-0">
                  <span className="text-xs font-bold text-primary truncate block">
                    {m.name}
                  </span>
                </div>
                <div className="min-w-0">
                  <span className="text-xs text-foreground truncate block">
                    {m.urn}
                  </span>
                </div>
                <div>
                  <span className="text-xs text-foreground">
                    {m.version || "—"}
                  </span>
                </div>
                <div>
                  <Badge variant={STATUS_VARIANT[m.status]}>{m.status}</Badge>
                </div>
                <div className="hidden lg:block">
                  <span className="text-xs text-foreground">{m.modelType}</span>
                </div>
                <div className="hidden xl:block">
                  <span className="text-xs text-foreground">
                    {formatBytes(m.contentBytes)}
                  </span>
                </div>
                <div className="hidden xl:block min-w-0">
                  <span
                    className="text-xs text-foreground truncate block"
                    title={formatDate(m.updatedAt, locale)}
                  >
                    {formatDate(m.updatedAt, locale)}
                  </span>
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
      <SemanticModelDetailDialog
        urn={detailUrn}
        onClose={() => setDetailUrn(null)}
        onEdit={() => {
          if (!detailUrn) return;
          setEditorMode("edit");
          setEditorUrn(detailUrn);
          setEditorOpen(true);
          setDetailUrn(null);
        }}
        onDelete={summary => {
          setDeleteTarget(summary);
          setDetailUrn(null);
        }}
      />

      {/* Editor dialog */}
      <SemanticModelEditorDialog
        open={editorOpen}
        mode={editorMode}
        initialUrn={editorUrn}
        onClose={() => setEditorOpen(false)}
        onSaved={() => {
          setEditorOpen(false);
          qc.invalidateQueries({ queryKey: ["semantic-models"] });
        }}
      />

      {/* Delete confirm */}
      <DeleteConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        itemName={deleteTarget?.name ?? ""}
        subtitle={deleteTarget?.urn}
        onConfirm={async () => {
          if (deleteTarget) await deleteSemanticModel(deleteTarget.urn);
        }}
        queryKeys={[["semantic-models"]]}
        successMessage={
          deleteTarget ? t.submodels.msg.deleted(deleteTarget.name) : undefined
        }
      />
    </>
  );
}

/* ─── Detail dialog ──────────────────────────────────────────── */
function SemanticModelDetailDialog({
  urn,
  onClose,
  onEdit,
  onDelete,
}: {
  urn: string | null;
  onClose: () => void;
  onEdit: () => void;
  onDelete: (summary: SemanticModelSummary) => void;
}) {
  const { t, locale } = useI18n();
  const [model, setModel] = useState<SemanticModel | null>(null);
  const [loading, setLoading] = useState(false);
  const [contentView, setContentView] = useState<"tree" | "raw">("tree");
  // SAMM 본문을 구조 트리로 파싱(실패 시 null → 원문 폴백)
  const aspect = useMemo(
    () => parseSammAspect(model?.content ?? ""),
    [model?.content]
  );

  useEffect(() => {
    if (!urn) {
      setModel(null);
      return;
    }
    setLoading(true);
    fetchSemanticModel(urn)
      .then(data => setModel(data))
      .catch(e => toast.error((e as Error).message))
      .finally(() => setLoading(false));
  }, [urn]);

  if (!urn) return null;
  const copy = (s: string, label?: string) => {
    navigator.clipboard.writeText(s);
    toast.success(label ?? t.common.copied);
  };
  const downloadContent = () => {
    if (!model) return;
    const blob = new Blob([model.content], { type: "text/turtle" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safe = (model.name || "model").replace(/[^a-z0-9._-]/gi, "_");
    a.href = url;
    a.download = `${safe}-${model.version || "v"}.ttl`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <SlidePanel open={!!urn} onClose={onClose} className="sm:max-w-2xl">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2 flex-wrap pr-8">
          <Layers className="w-4 h-4 text-violet-500 flex-shrink-0" />
          <h2 className="text-[15px] font-semibold text-foreground truncate">
            {model?.name ?? t.submodels.detail.title}
          </h2>
          {model && (
            <Badge variant={STATUS_VARIANT[model.status]}>{model.status}</Badge>
          )}
          <button
            onClick={onClose}
            className="ml-auto -mr-1 p-1 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            aria-label={t.common.close}
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Body */}
      {loading || !model ? (
        <div className="flex-1 flex items-center justify-center py-10 gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-[13px]">{t.common.loading}</span>
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-5 space-y-5 text-xs">
          {/* 기본 정보 */}
          <DetailSection title={t.submodels.detail.title}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <InfoCard
                label="URN"
                value={model.urn}
                span
                mono
                copyable={model.urn}
              />
              <InfoCard
                label={t.submodels.col.version}
                value={model.version || "—"}
                mono
              />
              <InfoCard
                label={t.submodels.col.modelType}
                value={model.modelType}
              />
              <InfoCard
                label={t.submodels.col.created}
                value={formatDate(model.createdAt, locale)}
              />
              <InfoCard
                label={t.submodels.col.updated}
                value={formatDate(model.updatedAt, locale)}
              />
              {model.descriptionKo && (
                <InfoCard
                  label={t.submodels.form.descriptionKo}
                  value={model.descriptionKo}
                  span
                />
              )}
              {model.descriptionEn && (
                <InfoCard
                  label={t.submodels.form.descriptionEn}
                  value={model.descriptionEn}
                  span
                />
              )}
            </div>
          </DetailSection>

          {/* Content */}
          <DetailSection
            title={t.submodels.detail.content}
            action={
              <div className="flex items-center gap-1">
                {aspect && (
                  <div className="flex rounded-md border border-border overflow-hidden mr-1">
                    <button
                      onClick={() => setContentView("tree")}
                      aria-pressed={contentView === "tree"}
                      className={cn(
                        "text-[11px] px-2 py-0.5 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary",
                        contentView === "tree"
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-muted"
                      )}
                    >
                      {t.submodels.detail.viewTree}
                    </button>
                    <button
                      onClick={() => setContentView("raw")}
                      aria-pressed={contentView === "raw"}
                      className={cn(
                        "text-[11px] px-2 py-0.5 border-l border-border transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary",
                        contentView === "raw"
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-muted"
                      )}
                    >
                      {t.submodels.detail.viewRaw}
                    </button>
                  </div>
                )}
                <button
                  onClick={() => copy(model.content)}
                  disabled={!model.content}
                  className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border border-border hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-50 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                >
                  <Copy className="w-3 h-3" /> {t.submodels.detail.copyContent}
                </button>
                <button
                  onClick={downloadContent}
                  disabled={!model.content}
                  className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border border-border hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-50 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                >
                  <Download className="w-3 h-3" />{" "}
                  {t.submodels.detail.downloadContent}
                </button>
              </div>
            }
          >
            {model.content ? (
              aspect && contentView === "tree" ? (
                <SammTree aspect={aspect} />
              ) : (
                <>
                  {!aspect && (
                    <div className="mb-2 flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
                      <AlertCircle className="w-3 h-3 flex-shrink-0" />
                      {t.submodels.detail.parseFailed}
                    </div>
                  )}
                  <pre className="max-h-[40vh] overflow-auto bg-muted/30 border border-border rounded-lg p-3 text-[11px] mono leading-relaxed whitespace-pre text-foreground">
                    {model.content}
                  </pre>
                </>
              )
            ) : (
              <div className="text-[12px] text-muted-foreground py-4 text-center">
                {t.submodels.detail.noContent}
              </div>
            )}
          </DetailSection>
        </div>
      )}

      {/* Footer */}
      <div className="px-5 py-4 bg-muted/30 border-t border-border flex items-center gap-2 flex-shrink-0">
        <RoleGate permission="resource:write">
          <button
            onClick={onEdit}
            disabled={!model}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground rounded-md transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
          >
            <Pencil size={13} /> {t.common.edit}
          </button>
          <button
            onClick={() =>
              model &&
              onDelete({
                urn: model.urn,
                name: model.name,
                version: model.version,
                status: model.status,
                modelType: model.modelType,
                descriptionKo: model.descriptionKo,
                descriptionEn: model.descriptionEn,
                contentBytes: model.content?.length ?? 0,
                createdAt: model.createdAt,
                updatedAt: model.updatedAt,
              })
            }
            disabled={!model}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-md transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-1 focus-visible:ring-rose-400"
          >
            <Trash2 size={13} /> {t.common.delete}
          </button>
        </RoleGate>
        <div className="flex-1" />
        <button
          onClick={onClose}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium border border-border text-foreground rounded-md hover:bg-muted transition-colors"
        >
          <X size={13} /> {t.common.close}
        </button>
      </div>
    </SlidePanel>
  );
}

/* ─── Editor dialog (create + edit) ──────────────────────────── */
function SemanticModelEditorDialog({
  open,
  mode,
  initialUrn,
  onClose,
  onSaved,
}: {
  open: boolean;
  mode: "create" | "edit";
  initialUrn: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [urn, setUrn] = useState("");
  const [name, setName] = useState("");
  const [version, setVersion] = useState("");
  const [status, setStatus] = useState<SemanticModelStatus>("DRAFT");
  const [modelType, setModelType] = useState("SAMM");
  const [content, setContent] = useState("");
  const [descriptionKo, setDescriptionKo] = useState("");
  const [descriptionEn, setDescriptionEn] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(false);

  // 입력 TTL의 구조 인식 여부 — 정보성 피드백(저장은 막지 않음)
  const editAspect = useMemo(
    () => (content.trim() ? parseSammAspect(content) : null),
    [content]
  );

  const reset = () => {
    setUrn("");
    setName("");
    setVersion("");
    setStatus("DRAFT");
    setModelType("SAMM");
    setContent("");
    setDescriptionKo("");
    setDescriptionEn("");
  };

  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && initialUrn) {
      setLoading(true);
      fetchSemanticModel(initialUrn)
        .then(m => {
          setUrn(m.urn);
          setName(m.name);
          setVersion(m.version);
          setStatus(m.status);
          setModelType(m.modelType);
          setContent(m.content);
          setDescriptionKo(m.descriptionKo);
          setDescriptionEn(m.descriptionEn);
        })
        .catch(e => toast.error((e as Error).message))
        .finally(() => setLoading(false));
    } else {
      reset();
    }
  }, [open, mode, initialUrn]);

  const submit = async () => {
    if (!urn.trim()) {
      toast.error(t.submodels.form.urnRequired);
      return;
    }
    if (!name.trim()) {
      toast.error(t.submodels.form.nameRequired);
      return;
    }
    setSubmitting(true);
    try {
      const body: Partial<SemanticModel> = {
        urn: urn.trim(),
        name: name.trim(),
        version,
        status,
        modelType,
        content,
        descriptionKo,
        descriptionEn,
      };
      if (mode === "edit" && initialUrn) {
        await updateSemanticModel(initialUrn, body);
        toast.success(t.submodels.msg.updated(name));
      } else {
        await createSemanticModel(body);
        toast.success(t.submodels.msg.created(name));
      }
      reset();
      onSaved();
    } catch (e) {
      const err = e as {
        response?: { status?: number; data?: { error?: string } };
        message?: string;
      };
      const serverMsg = err.response?.data?.error;
      if (serverMsg === "duplicate-urn") {
        toast.error(t.submodels.form.duplicateUrn);
      } else if (serverMsg === "content-too-large" || err.response?.status === 413) {
        // 서버 코드(content-too-large)·413 모두 로컬라이즈 메시지로 흡수
        // (raw 영문 노출 방지 — id 42).
        toast.error(t.submodels.msg.tooLarge);
      } else if (serverMsg) {
        toast.error(serverMsg);
      } else {
        toast.error(err.message ?? t.submodels.msg.saveFailed);
      }
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
            {mode === "edit" ? t.submodels.edit : t.submodels.create}
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
        <div className="flex-1 overflow-y-auto p-4 space-y-3 min-w-0">
          <FormField
            label={t.submodels.form.urn}
            required
            hint={
              mode === "edit"
                ? t.submodels.urnImmutable
                : t.submodels.form.urnHint
            }
          >
            <div className="relative">
              {mode === "edit" && (
                <Lock className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              )}
              <input
                value={urn}
                onChange={e => setUrn(e.target.value)}
                disabled={mode === "edit"}
                placeholder="urn:samm:io.catenax.pcf:7.0.0#Pcf"
                className={cn(inputBase, "mono", mode === "edit" && "pl-8")}
              />
            </div>
          </FormField>
          <FormField label={t.submodels.form.name} required>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Pcf"
              className={inputBase}
            />
          </FormField>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 min-w-0">
            <FormField
              label={t.submodels.form.version}
              hint={t.submodels.form.versionHint}
            >
              <input
                value={version}
                onChange={e => setVersion(e.target.value)}
                placeholder="7.0.0"
                className={`${inputBase} mono`}
              />
            </FormField>
            <FormField label={t.submodels.form.status}>
              <select
                value={status}
                onChange={e => setStatus(e.target.value as SemanticModelStatus)}
                className={inputBase}
              >
                {STATUSES.map(s => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField
              label={t.submodels.form.modelType}
              hint={t.submodels.form.modelTypeHint}
            >
              <input
                value={modelType}
                onChange={e => setModelType(e.target.value)}
                className={inputBase}
              />
            </FormField>
          </div>
          <FormField label={t.submodels.form.descriptionKo}>
            <input
              value={descriptionKo}
              onChange={e => setDescriptionKo(e.target.value)}
              lang="ko"
              className={inputBase}
            />
          </FormField>
          <FormField label={t.submodels.form.descriptionEn}>
            <input
              value={descriptionEn}
              onChange={e => setDescriptionEn(e.target.value)}
              lang="en"
              className={inputBase}
            />
          </FormField>
          <FormField
            label={t.submodels.form.content}
            hint={t.submodels.form.contentHint}
          >
            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              rows={14}
              spellCheck={false}
              placeholder={`@prefix samm: <urn:samm:org.eclipse.esmf.samm:meta-model:2.1.0#> .\n@prefix : <urn:samm:io.catenax.pcf:7.0.0#> .\n\n:Pcf a samm:Aspect ;\n   samm:preferredName "PCF"@en ;\n   samm:properties ( ) ;\n   samm:operations ( ) .\n`}
              className={`${inputBase} mono !text-[11px] whitespace-pre overflow-auto`}
              style={{ resize: "vertical" }}
            />
            <div className="flex items-center justify-between gap-2 mt-0.5">
              {content.trim() ? (
                editAspect ? (
                  <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="w-3 h-3" />{" "}
                    {t.submodels.form.structureOk}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400">
                    <AlertCircle className="w-3 h-3" />{" "}
                    {t.submodels.form.structureUnparsed}
                  </span>
                )
              ) : (
                <span />
              )}
              <span className="text-[10px] text-muted-foreground">
                {formatBytes(new Blob([content]).size)} / 256 KB
              </span>
            </div>
          </FormField>
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
          {t.submodels.form.cancel}
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
          {mode === "edit" ? t.submodels.form.update : t.submodels.form.submit}
        </PrimaryActionButton>
      </div>
    </SlidePanel>
  );
}
