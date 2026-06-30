// Connector Hub — Policy Management with ODRL Builder (spec 4.3)
// Left/Right Operand dynamic suggestions, responsive JSON preview

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import {
  fetchPolicies,
  createPolicy,
  updatePolicy,
  deletePolicy,
} from "@/services";
import { type Policy } from "@/lib/data";
import { useConnectorStore } from "@/stores/connectorStore";
import {
  DeleteConfirmDialog,
  ConfirmActionDialog,
  JsonViewerDialog,
  SlidePanel,
  InfoCard,
} from "@/components/DetailDeleteDialogs";
import {
  DataTablePagination,
  usePagination,
} from "@/components/DataTablePagination";
import {
  Card,
  CardTitle,
  Badge,
  SectionHdr,
  FormField,
  JsonTreeView,
  PrimaryActionButton,
  inputBase,
  ListError,
  ListEmpty,
} from "@/components/ui-kmx";
import {
  PlusCircle,
  Trash2,
  Eye,
  Code,
  ChevronDown,
  ChevronUp,
  Copy,
  Search,
  Shield,
  ShieldCheck,
  Link2,
  Loader2,
  AlertCircle,
  X,
  CheckCircle2,
  Circle,
  Hammer,
  Pencil,
  Files,
  ChevronsRight,
  List,
  Lock,
} from "lucide-react";
import { RoleGate } from "@/components/RoleGate";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/* ─── ODRL Constants (spec 4.3.1) ────────────────────────────── */
const LEFT_OPERANDS = [
  { value: "cx-policy:Membership", label: "Membership" },
  { value: "cx-policy:FrameworkAgreement", label: "Framework Agreement" },
  { value: "BusinessPartnerNumber", label: "Business Partner Number" },
  { value: "cx-policy:UsagePurpose", label: "Usage Purpose" },
  {
    value: "https://w3id.org/kmx/v0.1/ns/transferCount",
    label: "Transfer Count (공유 횟수)",
  },
];

const OPERATORS = [
  { value: "odrl:eq", label: "eq (=)" },
  { value: "odrl:in", label: "in (IN)" },
  { value: "odrl:neq", label: "neq (!=)" },
  { value: "odrl:gt", label: "gt (>)" },
  { value: "odrl:lt", label: "lt (<)" },
];

interface PolicyTemplate {
  id: string;
  label: string;
  description: string;
  ruleType: RuleType;
  action: string;
  logicOp?: LogicOp;
  constraints: Constraint[];
}

const POLICY_TEMPLATES: PolicyTemplate[] = [
  {
    id: "membership-active",
    label: "Catena-X Membership (Active)",
    description: "Catena-X 멤버십이 활성화된 참여자에게만 사용 허가.",
    ruleType: "permission",
    action: "use",
    constraints: [
      {
        leftOperand: "cx-policy:Membership",
        operator: "odrl:eq",
        rightOperand: "active",
      },
    ],
  },
  {
    id: "framework-traceability",
    label: "Framework Agreement (Traceability 1.0)",
    description: "Traceability 프레임워크 계약을 체결한 참여자만 허가.",
    ruleType: "permission",
    action: "use",
    constraints: [
      {
        leftOperand: "cx-policy:FrameworkAgreement",
        operator: "odrl:eq",
        rightOperand: "Traceability:1.0",
      },
    ],
  },
  {
    id: "transfer-count-limit",
    label: "Transfer Count Limit (공유 횟수 제한)",
    description: "계약(agreement)당 데이터 전송 횟수를 N회 미만으로 제한.",
    ruleType: "permission",
    action: "use",
    constraints: [
      {
        leftOperand: "https://w3id.org/kmx/v0.1/ns/transferCount",
        operator: "odrl:lt",
        rightOperand: "5",
      },
    ],
  },
  {
    id: "bpn-allowlist-bmw-vw",
    label: "BPN Allowlist (BMW + VW)",
    description: "지정된 BPN 두 곳만 사용 허가 (OR 결합).",
    ruleType: "permission",
    action: "use",
    logicOp: "or",
    constraints: [
      {
        leftOperand: "BusinessPartnerNumber",
        operator: "odrl:eq",
        rightOperand: "BPNL000000000BMW",
      },
      {
        leftOperand: "BusinessPartnerNumber",
        operator: "odrl:eq",
        rightOperand: "BPNL000000000VW",
      },
    ],
  },
  {
    id: "membership-and-framework",
    label: "Membership + Framework (AND)",
    description:
      "활성 멤버십 AND Data Exchange Governance 프레임워크 동시 충족.",
    ruleType: "permission",
    action: "use",
    logicOp: "and",
    constraints: [
      {
        leftOperand: "cx-policy:Membership",
        operator: "odrl:eq",
        rightOperand: "active",
      },
      {
        leftOperand: "cx-policy:FrameworkAgreement",
        operator: "odrl:eq",
        rightOperand: "DataExchangeGovernance:1.0",
      },
    ],
  },
  {
    id: "prohibit-third-country-transfer",
    label: "Prohibition: 3rd-country Transfer",
    description: "특정 국가로의 데이터 전송 금지 (prohibition + transfer).",
    ruleType: "prohibition",
    action: "transfer",
    constraints: [
      {
        leftOperand: "cx-policy:DataDestination",
        operator: "odrl:in",
        rightOperand: "CN,RU,KP",
      },
    ],
  },
  {
    id: "usage-purpose-dtr",
    label: "Usage Purpose: Digital Twin Registry",
    description: "디지털 트윈 레지스트리 용도로만 사용 허가.",
    ruleType: "permission",
    action: "use",
    constraints: [
      {
        leftOperand: "cx-policy:UsagePurpose",
        operator: "odrl:eq",
        rightOperand: "cx.core.digitalTwinRegistry:1",
      },
    ],
  },
];

const RIGHT_OPERAND_SUGGESTIONS: Record<string, string[]> = {
  "cx-policy:Membership": ["active"],
  "cx-policy:FrameworkAgreement": [
    "DataExchangeGovernance:1.0",
    "Traceability:1.0",
    "QualityManagement:1.0",
  ],
  BusinessPartnerNumber: ["BPNL000000000BMW", "BPNL000000000VW"],
  "cx-policy:UsagePurpose": [
    "cx.core.digitalTwinRegistry:1",
    "cx.core.industrycore:1",
  ],
};

type LogicOp = "and" | "or" | "xone";
const LOGIC_OPS: { value: LogicOp; key: "and" | "or" | "xone" }[] = [
  { value: "and", key: "and" },
  { value: "or", key: "or" },
  { value: "xone", key: "xone" },
];

type RuleType = "permission" | "prohibition" | "obligation";
const RULE_TYPES: {
  value: RuleType;
  key: "permission" | "prohibition" | "obligation";
}[] = [
  { value: "permission", key: "permission" },
  { value: "prohibition", key: "prohibition" },
  { value: "obligation", key: "obligation" },
];

const ACTIONS = [
  "use",
  "transfer",
  "display",
  "distribute",
  "derive",
  "anonymize",
  "aggregate",
  "modify",
];

interface Constraint {
  leftOperand: string;
  operator: string;
  rightOperand: string;
}

/* ── 서버 계약 소비용 로컬 타입 ──────────────────────────────────
 * 서버 mapPolicy는 구조화된 rules(다중 rule·다중 제약·prohibition/obligation 보존)와
 * 첫 rule 요약(ruleType/action)을 함께 보낸다. lib/data.ts Policy 타입은 공유(수정 금지)라
 * 아직 이 필드가 없으므로 여기서 로컬로 확장해 타입세이프하게 소비한다.
 */
interface ParsedConstraint {
  left: string;
  op: string;
  right: string;
}
interface PolicyRule {
  ruleType: "permission" | "prohibition" | "obligation";
  action: string;
  constraints: ParsedConstraint[];
}
type PolicyWithRules = Policy & {
  rules?: PolicyRule[];
  ruleType?: string;
  action?: string;
};

/**
 * 정책 제약을 구조화 배열로 추출. 서버가 보내는 구조화 p.rules를 우선 사용하고,
 * 없으면 레거시 p.constraint("left op right" 토큰을 "; " 구분으로 결합) 문자열을 파싱한다.
 * (과거: 첫 콜론 기준 분해 + op 항상 'eq' 하드코딩으로 실제 연산자/operand가 깨져 표시 — id 16/19)
 */
function policyConstraints(p: Policy): ParsedConstraint[] {
  const rules = (p as PolicyWithRules).rules;
  if (Array.isArray(rules) && rules.length > 0) {
    return rules.flatMap(r => r.constraints ?? []);
  }
  return parseConstraints(p.constraint);
}

/** 정책의 첫 rule 액션 표시값(odrl: 접두 정규화). 서버 미제공 시 'use' 폴백. */
function policyAction(p: Policy): string {
  const a = (p as PolicyWithRules).action;
  const raw = a && a.trim() ? a : "use";
  return raw.startsWith("odrl:") ? raw : `odrl:${raw}`;
}

/** 정책의 첫 rule 유형. 서버 미제공 시 permission 폴백. */
function policyRuleType(
  p: Policy
): "permission" | "prohibition" | "obligation" {
  const rt = (p as PolicyWithRules).ruleType;
  return rt === "prohibition" || rt === "obligation" ? rt : "permission";
}

/**
 * 레거시 constraint 문자열 파서. 서버 형식은 "left op right" 토큰을 "; "로 결합한 것
 * (예: "cx-policy:Membership eq active; BusinessPartnerNumber in BPNL...").
 * 공백 3토큰을 left/op/right로 인식하고 op는 실제 연산자를 보존(eq 하드코딩 제거).
 */
function parseConstraints(constraint: string): ParsedConstraint[] {
  if (!constraint || constraint === "No constraints") return [];
  return constraint
    .split(/[;,]/) // 다중 제약 구분자(서버는 "; ", 레거시 ',' 호환)
    .map(s => s.trim())
    .filter(Boolean)
    .map(part => {
      const tokens = part.split(/\s+/);
      if (tokens.length >= 3) {
        return {
          left: tokens[0],
          op: tokens[1].replace(/^odrl:/, ""),
          right: tokens.slice(2).join(" "),
        };
      }
      if (tokens.length === 2) {
        // "action: <value>" 류 레거시(콜론 키:값) — left=키, right=값
        return { left: tokens[0].replace(/:$/, ""), op: "", right: tokens[1] };
      }
      return { left: part, op: "", right: "" };
    });
}

export default function PagePolicy() {
  const { t } = useI18n();
  const connector = useConnectorStore(s => s.connector);
  const connectorId = connector?.id;
  const [tab, setTab] = useState<"list" | "builder">("list");
  const [search, setSearch] = useState("");
  const [detailTarget, setDetailTarget] = useState<Policy | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Policy | null>(null);
  const [builderDirty, setBuilderDirty] = useState(false);
  const [pendingTabSwitch, setPendingTabSwitch] = useState<"list" | null>(null);
  const [editTarget, setEditTarget] = useState<Policy | null>(null);
  const [duplicateSource, setDuplicateSource] = useState<Policy | null>(null);
  const [jsonTarget, setJsonTarget] = useState<Policy | null>(null);
  const {
    data: policies = [],
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["policies", connectorId],
    queryFn: () => fetchPolicies(connectorId!),
    enabled: !!connectorId,
  });

  const switchTab = (next: "list" | "builder") => {
    if (next === "list" && tab === "builder" && builderDirty) {
      setPendingTabSwitch("list");
      return;
    }
    setTab(next);
  };

  // Close the builder slide panel and clear edit/duplicate context
  const closeBuilder = () => {
    setBuilderDirty(false);
    setEditTarget(null);
    setDuplicateSource(null);
    setTab("list");
  };
  // Close request from backdrop / Esc / cancel — guard unsaved changes
  const requestCloseBuilder = () => {
    if (builderDirty) {
      setPendingTabSwitch("list");
      return;
    }
    closeBuilder();
  };

  const filtered = policies.filter(
    p =>
      (p.id ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (p.constraint ?? "").toLowerCase().includes(search.toLowerCase())
  );

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
        icon={<ShieldCheck className="w-5 h-5 text-primary" />}
        action={
          <RoleGate permission="resource:write">
            <PrimaryActionButton
              onClick={() => switchTab("builder")}
              icon={<PlusCircle className="w-3 h-3" />}
            >
              {t.policies.createOdrl}
            </PrimaryActionButton>
          </RoleGate>
        }
      >
        {t.policies.title}
      </SectionHdr>

      {/* Search */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder={t.policies.searchPlaceholder}
            value={search}
            onChange={e => {
              setSearch(e.target.value);
              setCurrentPage(1);
            }}
            aria-label={t.policies.searchPlaceholder}
            className={`${inputBase} pl-8 pr-8`}
          />
          {search && (
            <button
              onClick={() => {
                setSearch("");
                setCurrentPage(1);
              }}
              aria-label={t.common.clear ?? "Clear"}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Loading state */}
      {isLoading && (
        <Card>
          <div className="flex items-center justify-center py-10 gap-2 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-[13px]">{t.common.loading}</span>
          </div>
        </Card>
      )}

      {/* Error state */}
      {!isLoading && isError && (
        <Card>
          <ListError onRetry={() => refetch()} fetching={isFetching} />
        </Card>
      )}

      {!isLoading && !isError && (
        <PolicyList
          onSelect={setDetailTarget}
          onCreateClick={() => switchTab("builder")}
          policies={paginatedData}
          totalItems={totalItems}
          allCount={policies.length}
          currentPage={currentPage}
          pageSize={pageSize}
          setCurrentPage={setCurrentPage}
          setPageSize={setPageSize}
          selectedId={detailTarget?.id}
        />
      )}
      {/* 빌더 탭일 때만 마운트 — 닫으면 unmount 되어 폼이 리셋된다(이전 입력 잔존 방지). */}
      {connectorId && tab === "builder" && (
        <ODRLBuilder
          key={
            (editTarget?.id ?? "") +
            "|" +
            (duplicateSource?.id ?? "") +
            "|" +
            (editTarget ? "e" : duplicateSource ? "d" : "n")
          }
          open={tab === "builder"}
          connectorId={connectorId}
          existingPolicyIds={policies.map(p => p.id)}
          editTarget={editTarget}
          duplicateSource={duplicateSource}
          onDone={closeBuilder}
          onCancel={requestCloseBuilder}
          onDirtyChange={setBuilderDirty}
        />
      )}

      {/* JSON Viewer */}
      {jsonTarget && (
        <PolicyJsonDialog
          policy={jsonTarget}
          onClose={() => setJsonTarget(null)}
        />
      )}

      {/* Unsaved changes confirmation */}
      <ConfirmActionDialog
        open={!!pendingTabSwitch}
        onClose={() => setPendingTabSwitch(null)}
        title={t.common.unsavedChanges}
        description={t.common.unsavedChangesDesc}
        tone="warn"
        cancelLabel={t.common.stay}
        confirmLabel={t.common.leave}
        onConfirm={() => {
          setPendingTabSwitch(null);
          closeBuilder();
        }}
      />

      {detailTarget && (
        <PolicyDetailSheet
          target={detailTarget}
          onClose={() => setDetailTarget(null)}
          onEdit={() => {
            setEditTarget(detailTarget);
            setDetailTarget(null);
            setTab("builder");
          }}
          onDuplicate={() => {
            setDuplicateSource(detailTarget);
            setDetailTarget(null);
            setTab("builder");
          }}
          onShowJson={() => {
            setJsonTarget(detailTarget);
            setDetailTarget(null);
          }}
          onDelete={
            detailTarget.offers > 0
              ? undefined
              : () => {
                  setDeleteTarget(detailTarget);
                  setDetailTarget(null);
                }
          }
          deleteDisabledReason={
            detailTarget.offers > 0
              ? t.policies.deleteBlockedByOffering
              : undefined
          }
        />
      )}

      {deleteTarget && connectorId && (
        <DeleteConfirmDialog
          open={!!deleteTarget}
          onClose={() => setDeleteTarget(null)}
          itemName={deleteTarget.id}
          onConfirm={() => deletePolicy(deleteTarget.id, connectorId)}
          queryKeys={[["policies", connectorId]]}
        />
      )}
    </>
  );
}

/* ─── JSON Viewer Dialog ─────────────────────────────────────── */
function PolicyJsonDialog({
  policy,
  onClose,
}: {
  policy: Policy;
  onClose: () => void;
}) {
  const { t } = useI18n();
  // 실제 ruleType/action으로 envelope 구성(과거: permission+use 하드코딩으로 prohibition/transfer 오표시 — id 19/20)
  const ruleKey = `odrl:${policyRuleType(policy)}`;
  const envelope = {
    "@context": "http://www.w3.org/ns/odrl.jsonld",
    "@type": "Set",
    "@id": policy.id,
    [ruleKey]: [
      {
        "odrl:action": policyAction(policy),
        "odrl:constraint": policyConstraints(policy).map(c => ({
          "odrl:leftOperand": c.left,
          "odrl:operator": {
            "@id": c.op?.startsWith("odrl:") ? c.op : `odrl:${c.op || "eq"}`,
          },
          "odrl:rightOperand": c.right,
        })),
      },
    ],
  };
  return (
    <JsonViewerDialog
      open={true}
      onClose={onClose}
      title={t.policies.jsonTitle}
      subtitle={policy.id}
      json={JSON.stringify(envelope, null, 2)}
      downloadName={policy.id}
    />
  );
}

/* ─── Empty State ────────────────────────────────────────────── */
function EmptyPolicies({ onCreateClick }: { onCreateClick: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="w-14 h-14 rounded-2xl bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center mb-4">
        <Shield className="w-7 h-7 text-blue-400" />
      </div>
      <p className="text-[15px] font-semibold text-foreground/80 mb-1">
        {t.policies.emptyTitle}
      </p>
      <p className="text-[12px] text-muted-foreground mb-4 max-w-[260px]">
        {t.policies.emptyDesc}
      </p>
      <RoleGate permission="resource:write">
        <button
          onClick={onCreateClick}
          className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-md bg-primary hover:bg-primary/90 text-primary-foreground font-medium transition-colors"
        >
          <PlusCircle className="w-3.5 h-3.5" />
          {t.policies.createOdrl}
        </button>
      </RoleGate>
    </div>
  );
}

function PolicyList({
  policies,
  onSelect,
  onCreateClick,
  totalItems,
  allCount,
  currentPage,
  pageSize,
  setCurrentPage,
  setPageSize,
  selectedId,
}: {
  policies: Policy[];
  onSelect?: (p: Policy) => void;
  onCreateClick?: () => void;
  totalItems: number;
  allCount: number;
  currentPage: number;
  pageSize: number;
  setCurrentPage: (n: number) => void;
  setPageSize: (n: number) => void;
  selectedId?: string;
}) {
  const { t } = useI18n();

  return (
    <>
      {/* Desktop/Tablet: Table */}
      <div className="hidden md:block bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border">
          <span className="font-display text-[14px] font-bold text-foreground flex items-center gap-2 truncate">
            <List className="w-4 h-4 text-primary" />
            {t.policies.list}
          </span>
          <span className="text-[11px] font-normal text-muted-foreground flex-shrink-0">
            {t.policies.resultCount(totalItems, allCount)}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px]">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-3 text-left text-[12px] font-bold text-foreground">
                  {t.policies.col.id}
                </th>
                <th className="px-4 py-3 text-left text-[12px] font-bold text-foreground">
                  {t.policies.col.action}
                </th>
                <th className="px-4 py-3 text-left text-[12px] font-bold text-foreground">
                  {t.policies.col.constraint}
                </th>
                <th className="px-4 py-3 text-left text-[12px] font-bold text-foreground">
                  {t.policies.col.offeringRef}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {policies.map(p => {
                const constraints = policyConstraints(p);
                return (
                  <tr
                    key={p.id}
                    onClick={() => onSelect?.(p)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={e => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelect?.(p);
                      }
                    }}
                    className={cn(
                      "table-row-hover cursor-pointer group focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary [&>td:first-child]:border-l-2",
                      selectedId === p.id
                        ? "bg-primary/5 [&>td:first-child]:border-l-primary"
                        : "[&>td:first-child]:border-l-transparent"
                    )}
                  >
                    <td className="px-4 py-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-xs font-bold text-primary truncate block">
                            {p.id}
                          </span>
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              navigator.clipboard.writeText(p.id);
                              toast.success(t.common.copied);
                            }}
                            className="opacity-60 group-hover:opacity-100 transition-opacity flex-shrink-0 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded"
                            aria-label={t.common.copy ?? "Copy"}
                          >
                            <Copy className="w-2.5 h-2.5 text-muted-foreground hover:text-foreground" />
                          </button>
                        </div>
                        <div className="text-xs text-foreground truncate">
                          {t.policies.constraintCount(constraints.length)}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {policyRuleType(p) !== "permission" && (
                          <Badge
                            variant={
                              policyRuleType(p) === "prohibition"
                                ? "red"
                                : "amber"
                            }
                            className="!font-normal"
                          >
                            {t.policies.ruleLabel[policyRuleType(p)]}
                          </Badge>
                        )}
                        <Badge variant="blue" className="!font-normal">
                          {policyAction(p)}
                        </Badge>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1 min-w-0">
                        {constraints.map((c, ci) => (
                          <div
                            key={ci}
                            className="flex items-center gap-1.5 min-w-0"
                          >
                            <span className="text-xs text-foreground truncate">
                              {c.left}
                            </span>
                            {c.op && (
                              <Badge variant="amber" className="!font-normal">
                                {c.op}
                              </Badge>
                            )}
                            <span className="text-xs text-foreground truncate">
                              {c.right}
                            </span>
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={p.offers > 0 ? "green" : "gray"}>
                        {p.offers > 0 ? (
                          <CheckCircle2 className="w-3 h-3" />
                        ) : (
                          <Circle className="w-3 h-3" />
                        )}
                        {t.policies.offeringRef(p.offers)}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {policies.length === 0 &&
            (allCount === 0 ? (
              <EmptyPolicies onCreateClick={onCreateClick ?? (() => {})} />
            ) : (
              <ListEmpty icon={<Search />} message={t.common.noResults} />
            ))}
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
        </div>
      </div>

      {/* Mobile: Card Stack */}
      <div className="md:hidden flex flex-col gap-2.5">
        {policies.map(p => {
          const constraints = policyConstraints(p);
          return (
            <div
              key={p.id}
              onClick={() => onSelect?.(p)}
              className="bg-card rounded-xl p-3.5 shadow-sm border border-border cursor-pointer hover:shadow-md transition-shadow"
            >
              <div className="flex items-start gap-2.5 mb-2">
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-bold text-primary truncate block">
                    {p.id}
                  </span>
                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    {policyRuleType(p) !== "permission" && (
                      <Badge
                        variant={
                          policyRuleType(p) === "prohibition" ? "red" : "amber"
                        }
                        className="!font-normal"
                      >
                        {t.policies.ruleLabel[policyRuleType(p)]}
                      </Badge>
                    )}
                    <Badge variant="blue" className="!font-normal">
                      {policyAction(p)}
                    </Badge>
                  </div>
                </div>
                <button
                  onClick={e => {
                    e.stopPropagation();
                    navigator.clipboard.writeText(p.id);
                    toast.success(t.common.copied);
                  }}
                >
                  <Copy className="w-3 h-3 text-muted-foreground" />
                </button>
              </div>
              <div className="flex flex-col gap-1 mb-2">
                {constraints.map((c, ci) => (
                  <div key={ci} className="flex items-center gap-1.5">
                    <span className="text-xs text-foreground">{c.left}</span>
                    {c.op && (
                      <Badge variant="amber" className="!font-normal">
                        {c.op}
                      </Badge>
                    )}
                    <span className="text-xs text-foreground">{c.right}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-1.5">
                <Link2 className="w-2.5 h-2.5 text-muted-foreground" />
                <Badge
                  variant={p.offers > 0 ? "blue" : "gray"}
                  className="!font-normal"
                >
                  {t.policies.offeringRef(p.offers)}
                </Badge>
              </div>
            </div>
          );
        })}
        {policies.length === 0 &&
          (allCount === 0 ? (
            <EmptyPolicies onCreateClick={onCreateClick ?? (() => {})} />
          ) : (
            <ListEmpty icon={<Search />} message={t.common.noResults} />
          ))}
      </div>
    </>
  );
}

/* ─── Policy Detail Sheet (asset-style) ──────────────────────── */
function PolicyDetailSheet({
  target,
  onClose,
  onEdit,
  onDuplicate,
  onShowJson,
  onDelete,
  deleteDisabledReason,
}: {
  target: Policy;
  onClose: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onShowJson: () => void;
  onDelete?: () => void;
  deleteDisabledReason?: string;
}) {
  const { t } = useI18n();
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [onClose]);

  const constraints = policyConstraints(target);
  const detailRuleType = policyRuleType(target);
  const detailAction = policyAction(target);
  const odrlObj = {
    "@context": "http://www.w3.org/ns/odrl.jsonld",
    "@type": "Set",
    "@id": target.id,
    [`odrl:${detailRuleType}`]: [
      {
        "odrl:action": detailAction,
        "odrl:constraint": constraints.map(c => ({
          "odrl:leftOperand": c.left,
          "odrl:operator": { "@id": `odrl:${c.op || "eq"}` },
          "odrl:rightOperand": c.right,
        })),
      },
    ],
  };

  return (
    <>
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/20 transition-opacity duration-200",
          entered ? "opacity-100" : "opacity-0"
        )}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className={cn(
          "fixed right-0 top-0 z-50 h-full w-full sm:max-w-2xl bg-card flex flex-col transition-transform duration-200 ease-out shadow-2xl",
          entered ? "translate-x-0" : "translate-x-full"
        )}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2 flex-wrap pr-8">
            <ShieldCheck className="w-4 h-4 text-primary flex-shrink-0" />
            <h2 className="text-[15px] font-semibold text-foreground truncate">
              {target.id}
            </h2>
            {detailRuleType !== "permission" && (
              <Badge
                variant={detailRuleType === "prohibition" ? "red" : "amber"}
                className="!font-normal"
              >
                {t.policies.ruleLabel[detailRuleType]}
              </Badge>
            )}
            <Badge variant="blue" className="!font-normal">
              {detailAction}
            </Badge>
            <Badge
              variant={target.offers > 0 ? "blue" : "gray"}
              className="!font-normal"
            >
              {t.policies.offeringRef(target.offers)}
            </Badge>
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
        <div className="flex-1 overflow-auto p-6 space-y-5 text-xs">
          <div>
            <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1">
              <ChevronsRight className="w-3.5 h-3.5 text-primary" />
              {t.policies.sectionBasic}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <InfoCard
                label={t.policies.col.id}
                value={target.id}
                span
                mono
                copyable={target.id}
              />
              <InfoCard
                label={t.policies.ruleType}
                value={t.policies.ruleLabel[detailRuleType]}
              />
              <InfoCard
                label={t.policies.col.action}
                value={detailAction}
                mono
              />
              <InfoCard
                label={t.policies.col.offeringRef}
                value={t.policies.offeringRef(target.offers)}
              />
            </div>
          </div>

          <div>
            <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1">
              <ChevronsRight className="w-3.5 h-3.5 text-primary" />
              {t.policies.sectionConstraints}
            </p>
            <div className="grid grid-cols-1 gap-3">
              {constraints.length === 0 ? (
                <p className="text-[11px] text-muted-foreground/60 italic">
                  {t.policies.noConstraints}
                </p>
              ) : (
                constraints.map((c, i) => (
                  <InfoCard
                    key={i}
                    label={`${t.policies.leftOperand} #${i + 1}`}
                    value={`${c.left}  ${c.op ? `[${c.op}]` : ""}  ${c.right}`}
                    mono
                    copyable={`${c.left} ${c.op || ""} ${c.right}`.trim()}
                  />
                ))
              )}
            </div>
          </div>

          <div>
            <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1">
              <ChevronsRight className="w-3.5 h-3.5 text-primary" />
              {t.policies.sectionJson}
            </p>
            <JsonTreeView data={odrlObj} className="max-h-[300px]" />
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-muted/30 border-t border-border flex items-center gap-2 flex-shrink-0">
          {onDelete && (
            <button
              onClick={onDelete}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-md transition-colors"
            >
              <Trash2 size={13} /> {t.common.delete}
            </button>
          )}
          {!onDelete && deleteDisabledReason && (
            <button
              disabled
              title={deleteDisabledReason}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted-foreground/40 cursor-not-allowed rounded-md"
            >
              <Trash2 size={13} /> {t.common.delete}
            </button>
          )}
          <button
            onClick={onShowJson}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground rounded-md transition-colors"
          >
            <Code size={13} /> JSON
          </button>
          <button
            onClick={onDuplicate}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground rounded-md transition-colors"
          >
            <Files size={13} /> {t.common.duplicate}
          </button>
          <div className="flex-1" />
          <button
            onClick={onEdit}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
          >
            <Pencil size={13} /> {t.common.edit}
          </button>
          <button
            onClick={onClose}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium border border-border text-foreground rounded-lg hover:bg-muted transition-colors"
          >
            <X size={13} /> {t.common.close}
          </button>
        </div>
      </aside>
    </>
  );
}

function ODRLBuilder({
  open,
  connectorId,
  existingPolicyIds = [],
  editTarget,
  duplicateSource,
  onDone,
  onCancel,
  onDirtyChange,
}: {
  open: boolean;
  connectorId: string;
  existingPolicyIds?: string[];
  editTarget?: Policy | null;
  duplicateSource?: Policy | null;
  onDone: () => void;
  onCancel?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const isEdit = !!editTarget;
  const baseSrc: Policy | null = editTarget ?? duplicateSource ?? null;

  const initialConstraints: Constraint[] = (() => {
    if (!baseSrc)
      return [
        {
          leftOperand: "cx-policy:Membership",
          operator: "odrl:eq",
          rightOperand: "active",
        },
      ];
    // 편집/복제는 서버 구조화 rules를 우선 소비(레거시 문자열 폴백 포함)해 라운드트립 정확화.
    const parsed = policyConstraints(baseSrc);
    if (parsed.length === 0)
      return [
        {
          leftOperand: "cx-policy:Membership",
          operator: "odrl:eq",
          rightOperand: "active",
        },
      ];
    return parsed.map(c => ({
      leftOperand: c.left || "cx-policy:Membership",
      operator: c.op
        ? c.op.startsWith("odrl:")
          ? c.op
          : `odrl:${c.op}`
        : "odrl:eq",
      rightOperand: c.right || "",
    }));
  })();

  const initialId = editTarget
    ? editTarget.id
    : duplicateSource
      ? `${duplicateSource.id}-copy`
      : "";
  const [policyId, setPolicyId] = useState(initialId);
  const [policyIdError, setPolicyIdError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // 동기 중복 제출 가드 — disabled={submitting}는 React state라 같은 틱 더블클릭을 못 막는다.
  const submittingRef = useRef(false);
  const [constraints, setConstraints] =
    useState<Constraint[]>(initialConstraints);
  // 편집/복제 시 ruleType/action을 baseSrc에서 복원(과거: 항상 permission/use로 초기화돼
  // prohibition/transfer 정책이 편집하면 permission/use로 덮어써지던 round-trip 붕괴 — id 17/18).
  const [ruleType, setRuleType] = useState<RuleType>(
    baseSrc ? policyRuleType(baseSrc) : "permission"
  );
  const [action, setAction] = useState<string>(() => {
    if (!baseSrc) return "use";
    const a = (baseSrc as PolicyWithRules).action;
    return a && a.trim() ? a.replace(/^odrl:/, "") : "use";
  });
  const [logicOp, setLogicOp] = useState<LogicOp>("and");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState<"builder" | "json">("builder");
  const [editorMode, setEditorMode] = useState<"builder" | "json">("builder");
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);

  // Try to parse pasted JSON into Builder constraints. Returns ok|err.
  const importFromJson = (): boolean => {
    try {
      const obj = JSON.parse(jsonText);
      // Detect rule type
      let detectedRule: RuleType = "permission";
      let rules: unknown[] = [];
      for (const r of RULE_TYPES) {
        const arr = obj[`odrl:${r.key}`] ?? obj[r.key];
        if (Array.isArray(arr) && arr.length > 0) {
          detectedRule = r.value;
          rules = arr;
          break;
        }
      }
      if (rules.length === 0) {
        setJsonError(t.policies.jsonNoPermission);
        return false;
      }
      const first = rules[0] as Record<string, unknown>;
      const detectedAction = (first["odrl:action"] ??
        first.action ??
        "use") as string;

      let detectedLogic: LogicOp = "and";
      const allConstraints: Constraint[] = [];
      const flattenConstraint = (c: Record<string, unknown>) => {
        // Logic wrappers
        for (const lo of LOGIC_OPS) {
          const inner = c[`odrl:${lo.key}`] ?? c[lo.key];
          if (Array.isArray(inner)) {
            detectedLogic = lo.value;
            for (const ic of inner)
              flattenConstraint(ic as Record<string, unknown>);
            return;
          }
        }
        // Plain constraint
        const left = c["odrl:leftOperand"] ?? c.leftOperand ?? "";
        const opRaw = c["odrl:operator"] ?? c.operator ?? "odrl:eq";
        const op =
          typeof opRaw === "string"
            ? opRaw
            : ((opRaw as Record<string, unknown>)["@id"] ?? "odrl:eq");
        const right = c["odrl:rightOperand"] ?? c.rightOperand ?? "";
        if (left || right) {
          allConstraints.push({
            leftOperand: String(left),
            operator: String(op).startsWith("odrl:")
              ? String(op)
              : `odrl:${op}`,
            rightOperand: String(right),
          });
        }
      };
      for (const perm of rules) {
        const permObj = perm as Record<string, unknown>;
        const cons = (permObj["odrl:constraint"] ??
          permObj.constraint ??
          []) as unknown[];
        if (!Array.isArray(cons)) continue;
        for (const c of cons) flattenConstraint(c as Record<string, unknown>);
      }
      if (allConstraints.length === 0) {
        setJsonError(t.policies.jsonNoConstraints);
        return false;
      }
      const parsedId = obj["@id"] ?? obj.id;
      if (parsedId && !isEdit) setPolicyId(String(parsedId));
      setRuleType(detectedRule);
      setAction(String(detectedAction));
      setLogicOp(detectedLogic);
      setConstraints(allConstraints);
      setJsonError(null);
      markDirty();
      return true;
    } catch (e) {
      setJsonError(
        t.policies.jsonInvalid +
          ": " +
          (e instanceof Error ? e.message : String(e))
      );
      return false;
    }
  };

  // Reset dirty flag when target changes
  useEffect(() => {
    onDirtyChange?.(false);
  }, [editTarget?.id, duplicateSource?.id, onDirtyChange]);

  // Default to the builder tab each time the panel opens
  useEffect(() => {
    if (open) setMobileTab("builder");
  }, [open]);

  const markDirty = () => {
    onDirtyChange?.(true);
  };

  const validatePolicyId = (id: string): string | null => {
    if (!id.trim()) return t.policies.policyIdRequired;
    if (id.length > 128) return t.policies.idTooLong;
    if (/\s/.test(id)) return t.policies.idNoSpaces;
    if (/[/?#%&]/.test(id)) return t.policies.idInvalidChars;
    if (!isEdit && existingPolicyIds.includes(id))
      return t.policies.idDuplicate;
    return null;
  };

  const addConstraint = () => {
    setConstraints([
      ...constraints,
      {
        leftOperand: "cx-policy:Membership",
        operator: "odrl:eq",
        rightOperand: "",
      },
    ]);
    markDirty();
  };

  const updateConstraint = (
    idx: number,
    field: keyof Constraint,
    value: string
  ) => {
    const next = [...constraints];
    next[idx] = { ...next[idx], [field]: value };
    if (field === "leftOperand") {
      const suggestions = RIGHT_OPERAND_SUGGESTIONS[value];
      if (suggestions?.length) next[idx].rightOperand = suggestions[0];
    }
    setConstraints(next);
    markDirty();
  };

  const removeConstraint = (idx: number) => {
    setConstraints(constraints.filter((_, i) => i !== idx));
    markDirty();
  };

  const applyTemplate = (tpl: PolicyTemplate) => {
    setRuleType(tpl.ruleType);
    setAction(tpl.action);
    if (tpl.logicOp) setLogicOp(tpl.logicOp);
    setConstraints(tpl.constraints.map(c => ({ ...c })));
    markDirty();
    toast.success(t.policies.templateApplied(tpl.label));
  };

  // 미리보기는 서버 buildPolicyDefinition과 동일한 변환 규칙으로 구성한다(미리보기=저장 정합 — id 17).
  // action: 콜론 없으면 odrl: 접두 부여 후 { "@id" }. operator도 { "@id" }. logicOp 래핑은 다중 제약일 때만.
  const ruleKey = `odrl:${ruleType}`;
  const actionId = action.includes(":") ? action : `odrl:${action}`;
  const constraintNodes = constraints.map(c => ({
    "odrl:leftOperand": c.leftOperand,
    "odrl:operator": { "@id": c.operator },
    "odrl:rightOperand": c.rightOperand,
  }));
  const constraintField =
    constraints.length > 1
      ? [{ [`odrl:${logicOp}`]: constraintNodes }]
      : constraintNodes;
  const rule: Record<string, unknown> = { "odrl:action": { "@id": actionId } };
  if (constraintField.length) rule["odrl:constraint"] = constraintField;
  const odrlObj = {
    "@context": "http://www.w3.org/ns/odrl.jsonld",
    "@type": "Set",
    [ruleKey]: [rule],
  };

  const handleSave = async () => {
    const idErr = validatePolicyId(policyId);
    if (idErr) {
      setPolicyIdError(idErr);
      toast.error(idErr);
      return;
    }
    if (constraints.some(c => !c.leftOperand.trim())) {
      toast.error(t.policies.leftOperandRequired);
      return;
    }
    if (constraints.some(c => !c.rightOperand.trim())) {
      toast.error(t.policies.rightOperandRequired);
      return;
    }
    // > / < (gt/lt) 비교 연산자는 순서 있는 값(이 앱에선 숫자뿐)에만 의미가 있으므로
    // 오른쪽 피연산자가 숫자인지 검증한다(예: 공유 횟수 < 5).
    if (
      constraints.some(
        c =>
          (c.operator === "odrl:gt" || c.operator === "odrl:lt") &&
          !/^-?\d+(\.\d+)?$/.test(c.rightOperand.trim())
      )
    ) {
      toast.error(t.policies.operandMustBeNumber);
      return;
    }
    // 더블클릭/중복 제출 방지 — 첫 호출이 진행 중이면 이후 호출은 즉시 무시(정책 2개 생성 차단).
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const payload = {
        policyId,
        ruleType,
        action,
        logicOp: constraints.length > 1 ? logicOp : undefined,
        constraints,
      } as Record<string, unknown>;
      if (isEdit) {
        await updatePolicy(policyId, payload, connectorId);
        toast.success(t.policies.updated);
      } else {
        await createPolicy(payload, connectorId);
        toast.success(t.policies.created);
      }
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string; message?: string } } })
          ?.response?.data?.error ||
        (err as { response?: { data?: { error?: string; message?: string } } })
          ?.response?.data?.message ||
        (err as Error)?.message ||
        "";
      toast.error(isEdit ? t.policies.updateFailed : t.policies.createFailed, {
        description: msg || undefined,
      });
      submittingRef.current = false;
      setSubmitting(false);
      return;
    }
    try {
      await queryClient.refetchQueries({ queryKey: ["policies", connectorId] });
    } catch {}
    submittingRef.current = false;
    setSubmitting(false);
    onDone();
  };

  const jsonImportContent = (
    <div className="space-y-3">
      <p className="text-[12px] text-muted-foreground">
        {t.policies.jsonImportHint}
      </p>
      <textarea
        value={jsonText}
        onChange={e => {
          setJsonText(e.target.value);
          setJsonError(null);
        }}
        placeholder={`{\n  "@context": "http://www.w3.org/ns/odrl.jsonld",\n  "@type": "Set",\n  "@id": "kmx-policy-v1",\n  "odrl:permission": [...]\n}`}
        rows={14}
        className="w-full text-[12px] mono p-4 rounded-xl bg-slate-900 text-slate-300 border border-slate-700 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-primary resize-y leading-relaxed"
      />
      {jsonError && (
        <div className="flex items-start gap-1.5 text-[11px] text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 rounded-md px-2 py-1.5">
          <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
          <span className="break-all">{jsonError}</span>
        </div>
      )}
      <div className="flex gap-2">
        <button
          onClick={() => {
            if (importFromJson()) {
              setEditorMode("builder");
              toast.success(t.policies.jsonImported);
            }
          }}
          className="text-[12px] px-3 py-1.5 rounded bg-primary hover:bg-primary/90 text-primary-foreground font-medium"
        >
          {t.policies.applyJson}
        </button>
        <button
          onClick={() => {
            setJsonText("");
            setJsonError(null);
          }}
          className="text-[12px] px-3 py-1.5 rounded border border-border hover:bg-muted text-muted-foreground"
        >
          {t.common.clear}
        </button>
      </div>
    </div>
  );

  const builderContent = (
    <div className="space-y-4">
      {/* Editor mode tabs + template selector */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex gap-1 p-1 bg-muted/40 rounded-md w-fit">
          {(["builder", "json"] as const).map(m => (
            <button
              key={m}
              onClick={() => setEditorMode(m)}
              className={`text-[11px] px-3 py-1 rounded transition-colors ${
                editorMode === m
                  ? "bg-card text-foreground font-medium shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {m === "builder"
                ? t.policies.modeBuilder
                : t.policies.modeJsonImport}
            </button>
          ))}
        </div>
        {editorMode === "builder" && (
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">
              {t.policies.template}:
            </span>
            <select
              defaultValue=""
              onChange={e => {
                const tpl = POLICY_TEMPLATES.find(p => p.id === e.target.value);
                if (tpl) applyTemplate(tpl);
                e.target.value = "";
              }}
              className="text-[11px] px-2 py-1 border border-border rounded-md bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary max-w-[260px]"
              title={t.policies.templateHint}
            >
              <option value="">{t.policies.templateChoose}</option>
              {POLICY_TEMPLATES.map(tpl => (
                <option
                  key={tpl.id}
                  value={tpl.id}
                  title={t.policies.templateDesc[tpl.id] ?? tpl.description}
                >
                  {tpl.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {editorMode === "json" ? (
        jsonImportContent
      ) : (
        <>
          <FormField
            label={t.policies.policyId}
            required
            hint={isEdit ? t.policies.idImmutable : undefined}
          >
            <div className="relative">
              {isEdit && (
                <Lock className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              )}
              <input
                value={policyId}
                onChange={e => {
                  setPolicyId(e.target.value);
                  setPolicyIdError(null);
                  markDirty();
                }}
                placeholder="kmx-policy-v1"
                disabled={isEdit}
                title={isEdit ? t.policies.idImmutable : undefined}
                className={cn(inputBase, "mono", isEdit && "pl-8")}
              />
            </div>
            {policyIdError && (
              <div className="flex items-center gap-1 mt-1 text-[11px] text-rose-600 dark:text-rose-400">
                <AlertCircle className="w-3 h-3" /> {policyIdError}
              </div>
            )}
          </FormField>

          <div className="grid grid-cols-1 gap-3">
            <FormField label={t.policies.ruleType} required>
              <select
                value={ruleType}
                onChange={e => {
                  setRuleType(e.target.value as RuleType);
                  markDirty();
                }}
                className={inputBase}
              >
                {RULE_TYPES.map(r => (
                  <option key={r.value} value={r.value}>
                    {r.value} ({t.policies.ruleLabel[r.key]})
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label={t.policies.action} required>
              <input
                value={action}
                onChange={e => {
                  setAction(e.target.value);
                  markDirty();
                }}
                list="odrl-actions"
                placeholder="use"
                className={`${inputBase} mono`}
              />
              <datalist id="odrl-actions">
                {ACTIONS.map(a => (
                  <option key={a} value={a} />
                ))}
              </datalist>
            </FormField>
          </div>

          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
              <ChevronsRight className="w-3.5 h-3.5 text-primary" />
              {t.policies.constraints}
            </div>
            {constraints.length > 1 && (
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground">
                  {t.policies.logicOp}:
                </span>
                <div className="flex gap-1 p-0.5 bg-muted/40 rounded-md">
                  {LOGIC_OPS.map(lo => (
                    <button
                      key={lo.value}
                      onClick={() => {
                        setLogicOp(lo.value);
                        markDirty();
                      }}
                      className={`text-[11px] px-2 py-0.5 rounded transition-colors ${
                        logicOp === lo.value
                          ? "bg-card text-foreground font-medium shadow-sm"
                          : "text-muted-foreground"
                      }`}
                      title={t.policies.logicLabel[lo.key]}
                    >
                      {lo.value.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {constraints.map((c, idx) => (
            <div
              key={idx}
              className="border border-border rounded-lg p-3 space-y-3 bg-muted/30"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-muted-foreground">
                  {t.policies.constraintN(idx + 1)}
                </span>
                <button
                  onClick={() => removeConstraint(idx)}
                  className="text-rose-500 hover:text-rose-700"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="grid grid-cols-1 gap-3">
                <FormField label={t.policies.leftOperand}>
                  <input
                    value={c.leftOperand}
                    onChange={e =>
                      updateConstraint(idx, "leftOperand", e.target.value)
                    }
                    list="odrl-left-operands"
                    placeholder="cx-policy:Membership"
                    className={`${inputBase} mono`}
                  />
                  <datalist id="odrl-left-operands">
                    {LEFT_OPERANDS.map(o => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </datalist>
                </FormField>
                <FormField label={t.policies.operator}>
                  <select
                    value={c.operator}
                    onChange={e =>
                      updateConstraint(idx, "operator", e.target.value)
                    }
                    className={inputBase}
                  >
                    {OPERATORS.map(o => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </FormField>
                <FormField label={t.policies.rightOperand}>
                  {(() => {
                    // 비교 연산자(> / <)는 순서 있는 값(이 앱에선 숫자)에만 의미가 있으므로
                    // 입력 시점에 숫자 키패드 힌트 + 안내/경고를 제공한다(저장 전 사전 안내).
                    const isCompare =
                      c.operator === "odrl:gt" || c.operator === "odrl:lt";
                    const numeric = /^-?\d+(\.\d+)?$/.test(
                      c.rightOperand.trim()
                    );
                    const showNumberError =
                      isCompare && c.rightOperand.trim() !== "" && !numeric;
                    return (
                      <>
                        <input
                          value={c.rightOperand}
                          onChange={e =>
                            updateConstraint(idx, "rightOperand", e.target.value)
                          }
                          list={`suggestions-${idx}`}
                          inputMode={isCompare ? "numeric" : undefined}
                          className={cn(
                            inputBase,
                            "mono",
                            showNumberError &&
                              "border-rose-400 focus:border-rose-400 ring-1 ring-rose-400"
                          )}
                        />
                        <datalist id={`suggestions-${idx}`}>
                          {(RIGHT_OPERAND_SUGGESTIONS[c.leftOperand] ?? []).map(
                            s => (
                              <option key={s} value={s} />
                            )
                          )}
                        </datalist>
                        {isCompare &&
                          (showNumberError ? (
                            <div className="flex items-center gap-1 mt-1 text-[11px] text-rose-600 dark:text-rose-400">
                              <AlertCircle className="w-3 h-3" />
                              {t.policies.operandNumberError}
                            </div>
                          ) : (
                            <div className="mt-1 text-[11px] text-muted-foreground">
                              {t.policies.operandNumberHint}
                            </div>
                          ))}
                      </>
                    );
                  })()}
                </FormField>
              </div>
            </div>
          ))}

          <button
            onClick={addConstraint}
            className="flex items-center gap-1 text-[11px] text-primary hover:text-primary/80 font-medium transition-colors"
          >
            <PlusCircle className="w-3 h-3" /> {t.policies.addConstraint}
          </button>
        </>
      )}
    </div>
  );

  const jsonPreview = (
    <div className="h-full">
      <div className="text-[11px] font-medium text-muted-foreground mb-2 uppercase tracking-wide flex items-center gap-1">
        <Code className="w-3 h-3" /> {t.policies.jsonPreview}
      </div>
      <JsonTreeView data={odrlObj} className="max-h-[400px]" />
    </div>
  );

  return (
    <SlidePanel open={open} onClose={onCancel ?? onDone} className="max-w-xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Hammer className="w-4 h-4 text-primary flex-shrink-0" />
          <span className="text-[15px] font-semibold text-foreground truncate">
            {isEdit
              ? t.policies.editBuilder
              : duplicateSource
                ? t.policies.duplicateBuilder
                : t.policies.builder}
          </span>
        </div>
        <button
          onClick={onCancel ?? onDone}
          className="-mr-1 p-1 rounded hover:bg-muted text-muted-foreground flex-shrink-0"
          aria-label={t.common.close}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Body: builder ⇄ JSON preview toggle */}
      <div className="flex-1 overflow-y-auto p-4 min-w-0">
        <div className="flex border-b border-border mb-3">
          {(["builder", "json"] as const).map(tb => (
            <button
              key={tb}
              onClick={() => setMobileTab(tb)}
              className={`px-4 py-2 text-[12px] border-b-2 transition-colors -mb-px flex-1 ${
                mobileTab === tb
                  ? "border-primary text-primary font-medium"
                  : "border-transparent text-muted-foreground"
              }`}
            >
              {tb === "builder" ? t.policies.builder : "JSON"}
            </button>
          ))}
        </div>
        {mobileTab === "builder" ? builderContent : jsonPreview}
      </div>

      {/* 통일 푸터 (PCF/ShellEditorDialog 패턴): 패널 하단 고정, 취소=버튼, 저장=프라이머리 */}
      <div className="flex items-center justify-end gap-2 px-3 py-2.5 border-t border-border bg-muted/20 flex-shrink-0">
        <button
          type="button"
          onClick={onCancel ?? onDone}
          className="text-[12px] px-3 py-1.5 rounded border border-border hover:bg-muted transition-colors mr-auto focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
        >
          {t.common.cancel}
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={submitting}
          className="text-[12px] px-3 py-1.5 rounded bg-primary hover:bg-primary/90 text-primary-foreground font-medium transition-colors disabled:opacity-60 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
        >
          {submitting
            ? t.policies.saving
            : isEdit
              ? t.common.save
              : t.policies.savePoliciy}
        </button>
      </div>
    </SlidePanel>
  );
}
