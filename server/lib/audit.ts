// KMX EDC — 감사 로그(Audit Log) 기록/조회 계층
// - recordAudit: 단건 기록(best-effort, 실패가 요청 흐름을 깨지 않음)
// - deriveAudit: HTTP method+path 로 변이(mutation) 라우트를 식별해 action/category 도출
//   (POST 가 목록 조회에도 쓰이므로 allowlist 로만 감사 — 조회는 기록하지 않음)
// - queryAudit: 테넌트 범위 최신순 조회 → 클라 AuditEvent 형태로 평탄화
// - pruneAuditLogs: 보존기간 초과분 정리(무한 증가 방지)

import { getPool } from "./db.js";
import { auditWriteFailures } from "./metrics.js";

export type AuditResult = "SUCCESS" | "FAILURE";
export type AuditSeverity = "INFO" | "WARN" | "CRITICAL";

export interface AuditEntry {
  tenantId?: string | null;
  actorId?: string | null;
  actorEmail?: string | null;
  actorRole?: string | null;
  action: string;
  category: string;
  target?: string | null;
  targetType?: string | null;
  connectorId?: string | null;
  result: AuditResult;
  severity?: AuditSeverity;
  statusCode?: number | null;
  ip?: string | null;
  userAgent?: string | null;
  method?: string | null;
  path?: string | null;
  message?: string | null;
}

/** action 코드 → 사람이 읽는 짧은 설명(목록 보조 라인용). 미정의 action 은 코드 그대로 표시. */
const ACTION_LABEL: Record<string, string> = {
  "auth.login": "Login",
  "auth.logout": "Logout",
  "connector.create": "Connector created",
  "connector.update": "Connector updated",
  "connector.delete": "Connector deleted",
  "connector.test": "Connection tested",
  "asset.create": "Asset created",
  "asset.update": "Asset updated",
  "asset.delete": "Asset deleted",
  "policy.create": "Policy created",
  "policy.update": "Policy updated",
  "policy.delete": "Policy deleted",
  "offering.create": "Contract created",
  "offering.update": "Contract updated",
  "offering.delete": "Contract deleted",
  "negotiation.start": "Negotiation started",
  "negotiation.terminate": "Negotiation terminated",
  "transfer.start": "Transfer started",
  "transfer.complete": "Transfer completed",
  "transfer.terminate": "Transfer terminated",
  "transfer.fetch": "Data fetched",
  "transfer.deleteAll": "Transfers cleared",
  "edr.delete": "EDR deleted",
  "settings.update": "Settings updated",
  "dtr.post": "Digital twin registered",
  "dtr.put": "Digital twin updated",
  "dtr.delete": "Digital twin deleted",
  "semantic.post": "Semantic model created",
  "semantic.put": "Semantic model updated",
  "semantic.delete": "Semantic model deleted",
  // 시스템 이벤트(알림 생성기가 감지 → 감사 로그에도 기록). 행위자 없음(system).
  "event.negotiation.failed": "Negotiation failed",
  "event.transfer.failed": "Transfer failed",
  "event.transfer.completed": "Transfer completed",
  "event.edr.expiring": "EDR expiring",
  "event.connector.unreachable": "Connector unreachable",
};

/** 심각도 도출: 실패(특히 인증/삭제)는 강조, 파괴적 성공은 WARN, 그 외 INFO. */
export function severityFor(
  action: string,
  result: AuditResult,
  category?: string
): AuditSeverity {
  if (result === "FAILURE") {
    return action.startsWith("auth.") || action.endsWith(".delete")
      ? "CRITICAL"
      : "WARN";
  }
  // 파괴적/민감 성공 동작은 WARN 으로 강조(삭제·종료·Vault 설정 변경).
  if (
    action.endsWith(".delete") ||
    action.endsWith(".deleteAll") ||
    action.includes("terminate") ||
    category === "VAULT"
  ) {
    return "WARN";
  }
  return "INFO";
}

export interface DerivedAudit {
  action: string;
  category: string;
  targetType: string;
  target: string;
}

/**
 * HTTP method + 전체 경로(/api 포함)로 변이 라우트를 식별. 감사 대상이 아니면 null.
 * 주의: 목록 조회가 POST 로 구현된 라우트(`/assets`, `/policies`, `/catalog` 등)는
 * allowlist 에 없으므로 자동으로 제외된다(조회는 감사하지 않음).
 */
export function deriveAudit(
  method: string,
  fullPath: string,
  body: unknown
): DerivedAudit | null {
  const p = fullPath.split("?")[0];
  const M = method.toUpperCase();
  const b = (body ?? {}) as Record<string, unknown>;
  const bodyId =
    (typeof b.id === "string" && b.id) ||
    (typeof b.assetId === "string" && b.assetId) ||
    (typeof b.name === "string" && b.name) ||
    "";
  const cap = (re: RegExp): string => {
    const m = p.match(re);
    return m ? decodeURIComponent(m[1]) : "";
  };

  // ── Connector ──
  if (M === "POST" && p === "/api/connectors")
    return {
      action: "connector.create",
      category: "CONNECTOR",
      targetType: "Connector",
      target: bodyId,
    };
  if (M === "POST" && p === "/api/connectors/test-connection")
    return {
      action: "connector.test",
      category: "CONNECTOR",
      targetType: "Connector",
      target: typeof b.managementUrl === "string" ? b.managementUrl : "",
    };
  if (M === "PUT" && /^\/api\/connectors\/[^/]+$/.test(p))
    return {
      action: "connector.update",
      category: "CONNECTOR",
      targetType: "Connector",
      target: cap(/\/connectors\/([^/]+)$/),
    };
  if (M === "DELETE" && /^\/api\/connectors\/[^/]+$/.test(p))
    return {
      action: "connector.delete",
      category: "CONNECTOR",
      targetType: "Connector",
      target: cap(/\/connectors\/([^/]+)$/),
    };

  // ── Asset ──
  if (M === "POST" && /\/assets\/create$/.test(p))
    return {
      action: "asset.create",
      category: "ASSET",
      targetType: "Asset",
      target: bodyId,
    };
  if (M === "PUT" && /\/assets\/[^/]+$/.test(p))
    return {
      action: "asset.update",
      category: "ASSET",
      targetType: "Asset",
      target: cap(/\/assets\/([^/]+)$/),
    };
  if (M === "DELETE" && /\/assets\/[^/]+$/.test(p))
    return {
      action: "asset.delete",
      category: "ASSET",
      targetType: "Asset",
      target: cap(/\/assets\/([^/]+)$/),
    };

  // ── Policy ──
  if (M === "POST" && /\/policies\/create$/.test(p))
    return {
      action: "policy.create",
      category: "POLICY",
      targetType: "Policy",
      target: bodyId,
    };
  if (M === "PUT" && /\/policies\/[^/]+$/.test(p))
    return {
      action: "policy.update",
      category: "POLICY",
      targetType: "Policy",
      target: cap(/\/policies\/([^/]+)$/),
    };
  if (M === "DELETE" && /\/policies\/[^/]+$/.test(p))
    return {
      action: "policy.delete",
      category: "POLICY",
      targetType: "Policy",
      target: cap(/\/policies\/([^/]+)$/),
    };

  // ── Offering(계약) ──
  if (M === "POST" && /\/offerings\/create$/.test(p))
    return {
      action: "offering.create",
      category: "OFFERING",
      targetType: "Offering",
      target: bodyId,
    };
  if (M === "PUT" && /\/offerings\/[^/]+$/.test(p))
    return {
      action: "offering.update",
      category: "OFFERING",
      targetType: "Offering",
      target: cap(/\/offerings\/([^/]+)$/),
    };
  if (M === "DELETE" && /\/offerings\/[^/]+$/.test(p))
    return {
      action: "offering.delete",
      category: "OFFERING",
      targetType: "Offering",
      target: cap(/\/offerings\/([^/]+)$/),
    };

  // ── Negotiation ──
  if (M === "POST" && /\/negotiations\/start$/.test(p))
    return {
      action: "negotiation.start",
      category: "NEGOTIATION",
      targetType: "Negotiation",
      target: typeof b.assetId === "string" ? b.assetId : "",
    };
  if (M === "POST" && /\/negotiations\/[^/]+\/terminate$/.test(p))
    return {
      action: "negotiation.terminate",
      category: "NEGOTIATION",
      targetType: "Negotiation",
      target: cap(/\/negotiations\/([^/]+)\/terminate$/),
    };

  // ── Transfer ──
  if (M === "POST" && /\/transfers\/start$/.test(p))
    return {
      action: "transfer.start",
      category: "TRANSFER",
      targetType: "Transfer",
      target: typeof b.assetId === "string" ? b.assetId : "",
    };
  if (M === "POST" && /\/transfers\/[^/]+\/complete$/.test(p))
    return {
      action: "transfer.complete",
      category: "TRANSFER",
      targetType: "Transfer",
      target: cap(/\/transfers\/([^/]+)\/complete$/),
    };
  if (M === "POST" && /\/transfers\/[^/]+\/terminate$/.test(p))
    return {
      action: "transfer.terminate",
      category: "TRANSFER",
      targetType: "Transfer",
      target: cap(/\/transfers\/([^/]+)\/terminate$/),
    };
  if (M === "POST" && /\/transfers\/[^/]+\/fetch$/.test(p))
    return {
      action: "transfer.fetch",
      category: "TRANSFER",
      targetType: "Transfer",
      target: cap(/\/transfers\/([^/]+)\/fetch$/),
    };
  if (M === "DELETE" && /\/transfers$/.test(p))
    return {
      action: "transfer.deleteAll",
      category: "TRANSFER",
      targetType: "Transfer",
      target: "*",
    };

  // ── EDR ──
  if (M === "DELETE" && /\/edrs\/[^/]+$/.test(p))
    return {
      action: "edr.delete",
      category: "TRANSFER",
      targetType: "EDR",
      target: cap(/\/edrs\/([^/]+)$/),
    };

  // ── Settings ──
  if (M === "PUT" && /^\/api\/system\/settings\//.test(p)) {
    const key = cap(/\/settings\/(.+)$/);
    return {
      action: "settings.update",
      category: key.includes("vault") ? "VAULT" : "SYSTEM",
      targetType: "Setting",
      target: key,
    };
  }

  // ── DTR(디지털 트윈 레지스트리) ──
  // POST /api/dtr/lookup 은 '조회'(shell id 검색)이므로 변이가 아니다 → 감사 제외.
  if (p === "/api/dtr/lookup") return null;
  if (
    /^\/api\/dtr\//.test(p) &&
    (M === "POST" || M === "PUT" || M === "DELETE")
  )
    return {
      action: `dtr.${M.toLowerCase()}`,
      category: "SYSTEM",
      targetType: "DigitalTwin",
      // 대상 식별자는 path 우선(submodelId > aasId), 없으면 body.
      target:
        cap(/\/submodels\/([^/]+)$/) || cap(/\/shells\/([^/]+)/) || bodyId,
    };

  // ── Semantic models ──
  if (
    /^\/api\/semantics\//.test(p) &&
    (M === "POST" || M === "PUT" || M === "DELETE")
  )
    return {
      action: `semantic.${M.toLowerCase()}`,
      category: "SYSTEM",
      targetType: "SemanticModel",
      target: cap(/\/models\/([^/]+)$/) || bodyId,
    };

  return null; // 감사 대상 아님(목록 조회 POST 등)
}

/** 사용자 제어 문자열의 제어문자 제거 + 길이 제한 — 로그 위조/혼동 방지(CWE-117). */
function clean(s: string | null | undefined, max = 512): string | null {
  if (s == null) return null;
  // 제어문자(\x00-\x1f, \x7f)를 공백으로 치환 — 로그/감사 인젝션 방어(의도적 control-char 매칭).
  // eslint-disable-next-line no-control-regex
  const stripped = String(s).replace(/[\x00-\x1f\x7f]/g, " ");
  return stripped.slice(0, max);
}

/** 단건 기록 — best-effort. 실패해도 throw 하지 않는다(감사 실패가 본 요청을 깨지 않게). */
export async function recordAudit(e: AuditEntry): Promise<void> {
  try {
    await getPool().query(
      `INSERT INTO audit_logs
         (tenant_id, actor_id, actor_email, actor_role, action, category, target, target_type,
          connector_id, result, severity, status_code, ip, user_agent, method, path, message)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [
        e.tenantId ?? null,
        e.actorId ?? null,
        clean(e.actorEmail),
        e.actorRole ?? null,
        e.action,
        e.category,
        clean(e.target),
        e.targetType ?? null,
        e.connectorId ?? null,
        e.result,
        e.severity ?? severityFor(e.action, e.result, e.category),
        e.statusCode ?? null,
        e.ip ?? null,
        clean(e.userAgent, 256),
        e.method ?? null,
        e.path ?? null,
        clean(e.message),
      ]
    );
  } catch (err) {
    auditWriteFailures.inc();
    console.error("[AUDIT] record failed:", (err as Error).message);
  }
}

interface AuditRow {
  id: string;
  actor_id: string | null;
  actor_email: string | null;
  actor_role: string | null;
  action: string;
  category: string;
  target: string | null;
  target_type: string | null;
  connector_id: string | null;
  result: AuditResult;
  severity: AuditSeverity | null;
  status_code: number | null;
  ip: string | null;
  user_agent: string | null;
  method: string | null;
  path: string | null;
  message: string | null;
  created_at: Date | string;
}

/** DB 행 → 클라 AuditEvent 형태(camelCase, ISO timestamp). */
function toAuditEvent(r: AuditRow) {
  return {
    id: r.id,
    timestamp: new Date(r.created_at).toISOString(),
    actor: r.actor_email || r.actor_id || "system",
    actorRole: r.actor_role || "system",
    action: r.action,
    category: r.category,
    target: r.target || "",
    targetType: r.target_type || "",
    result: r.result,
    severity: r.severity || "INFO",
    ip: r.ip || "",
    userAgent: r.user_agent || "",
    requestId: r.id,
    message: r.message || ACTION_LABEL[r.action] || r.action,
    payload: {
      method: r.method,
      path: r.path,
      statusCode: r.status_code,
      connectorId: r.connector_id,
    },
  };
}

/** 테넌트 범위 최신순 조회(최대 2000건). */
export async function queryAudit(
  tenantId: string,
  limit = 500,
  days?: number
): Promise<ReturnType<typeof toAuditEvent>[]> {
  const lim = Math.min(Math.max(1, Math.floor(limit) || 500), 2000);
  // 기간 필터는 서버에서 적용한다 — 클라 UI 의 기간 필터만 믿으면 LIMIT(기본 500)에
  // 최근 행이 먼저 차서 과거 기간 조회가 조용히 빈 결과/부분 결과가 된다.
  const d =
    typeof days === "number" && Number.isFinite(days)
      ? Math.min(Math.max(1, Math.floor(days)), 90)
      : null;
  const { rows } = await getPool().query<AuditRow>(
    `SELECT id, actor_id, actor_email, actor_role, action, category, target, target_type,
            connector_id, result, severity, status_code, ip, user_agent, method, path, message, created_at
       FROM audit_logs
      WHERE tenant_id = $1
        AND ($3::int IS NULL OR created_at >= NOW() - ($3 || ' days')::interval)
      ORDER BY created_at DESC
      LIMIT $2`,
    [tenantId, lim, d]
  );
  return rows.map(toAuditEvent);
}

/** 보존기간(기본 90일) 초과분 삭제 — best-effort. */
export async function pruneAuditLogs(
  retentionDays = Number(process.env.AUDIT_RETENTION_DAYS ?? 90)
): Promise<void> {
  try {
    await getPool().query(
      `DELETE FROM audit_logs WHERE created_at < NOW() - ($1 || ' days')::interval`,
      [String(Math.max(1, Math.floor(retentionDays) || 90))]
    );
  } catch (err) {
    console.error("[AUDIT] prune failed:", (err as Error).message);
  }
}

/** 테넌트 오프보딩(GDPR 삭제) 시 해당 테넌트의 감사 로그(actor_email·ip 등 PII 포함)를 삭제.
 *  삭제된 행 수를 반환. 오프보딩 트랜잭션에서 호출한다. */
export async function deleteAuditForTenant(tenantId: string): Promise<number> {
  const { rowCount } = await getPool().query(
    `DELETE FROM audit_logs WHERE tenant_id = $1`,
    [tenantId]
  );
  return rowCount ?? 0;
}
