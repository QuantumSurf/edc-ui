// KMX EDC — Semantic Models (local Postgres CRUD)
// Tractus-X 시맨틱 모델을 로컬 DB에 저장/수정/삭제하는 단순 CRUD.
// 외부 Semantic Hub 서비스 없이 자체 테이블(`semantic_models`)에 보관한다.

import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { getPool } from "../lib/db.js";
import { requireRole } from "../middleware/auth.js";

const router = Router();
const writeGuard = requireRole("admin", "operator");

const ALLOWED_STATUS = new Set([
  "DRAFT",
  "RELEASED",
  "STANDARDIZED",
  "DEPRECATED",
]);
const MAX_CONTENT_BYTES = 256 * 1024; // 256 KB
const MAX_TEXT = 500;

interface SemanticModelRow {
  urn: string;
  name: string;
  version: string;
  status: string;
  model_type: string;
  content: string;
  description_ko: string;
  description_en: string;
  created_at: string;
  updated_at: string;
}

function rowToJson(r: SemanticModelRow) {
  return {
    urn: r.urn,
    name: r.name,
    version: r.version,
    status: r.status,
    modelType: r.model_type,
    content: r.content,
    descriptionKo: r.description_ko,
    descriptionEn: r.description_en,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function rowToSummary(r: SemanticModelRow) {
  return {
    urn: r.urn,
    name: r.name,
    version: r.version,
    status: r.status,
    modelType: r.model_type,
    descriptionKo: r.description_ko,
    descriptionEn: r.description_en,
    contentBytes: Buffer.byteLength(r.content ?? "", "utf8"),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function validateBody(
  body: Record<string, unknown>,
  opts: { requireUrn: boolean }
): string | null {
  if (opts.requireUrn) {
    if (typeof body.urn !== "string" || body.urn.trim().length === 0)
      return "urn is required";
    if (body.urn.length > MAX_TEXT) return "urn too long";
  }
  if (typeof body.name !== "string" || body.name.trim().length === 0)
    return "name is required";
  if (body.name.length > MAX_TEXT) return "name too long";
  if (body.version != null && typeof body.version !== "string")
    return "version must be string";
  if (
    body.status != null &&
    (typeof body.status !== "string" || !ALLOWED_STATUS.has(body.status))
  ) {
    return "status invalid";
  }
  if (body.modelType != null && typeof body.modelType !== "string")
    return "modelType must be string";
  if (body.content != null) {
    if (typeof body.content !== "string") return "content must be string";
    // 안정적 에러 코드(duplicate-urn 컨벤션) — 클라가 코드로 로컬라이즈 분기 가능.
    if (Buffer.byteLength(body.content, "utf8") > MAX_CONTENT_BYTES)
      return "content-too-large";
  }
  if (body.descriptionKo != null && typeof body.descriptionKo !== "string")
    return "descriptionKo must be string";
  if (body.descriptionEn != null && typeof body.descriptionEn !== "string")
    return "descriptionEn must be string";
  return null;
}

// GET /api/semantics/models — list summaries (no content), tenant-scoped
router.get(
  "/models",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.user?.tenantId;
      // tenantId 없으면 빈 결과(타 테넌트 모델 노출 방지).
      if (!tenantId) {
        res.json({ items: [], total: 0 });
        return;
      }
      const search =
        typeof req.query.search === "string" ? req.query.search.trim() : "";
      // $1=tenant_id, $2=search(있을 때)
      const params: unknown[] = [tenantId];
      let where = "WHERE tenant_id = $1";
      if (search) {
        params.push(`%${search.toLowerCase()}%`);
        where += ` AND (LOWER(urn) LIKE $2 OR LOWER(name) LIKE $2 OR LOWER(description_ko) LIKE $2 OR LOWER(description_en) LIKE $2)`;
      }
      const { rows } = await getPool().query<SemanticModelRow>(
        `SELECT urn, name, version, status, model_type, content, description_ko, description_en, created_at, updated_at
       FROM semantic_models
       ${where}
       ORDER BY name ASC, version ASC`,
        params
      );
      res.json({ items: rows.map(rowToSummary), total: rows.length });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/semantics/models/:urn — fetch single (with content), tenant-scoped
router.get(
  "/models/:urn",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        res.status(404).json({ error: "not-found" });
        return;
      }
      const urn = decodeURIComponent(req.params.urn);
      const { rows } = await getPool().query<SemanticModelRow>(
        `SELECT * FROM semantic_models WHERE tenant_id = $1 AND urn = $2`,
        [tenantId, urn]
      );
      if (rows.length === 0) {
        res.status(404).json({ error: "not-found" });
        return;
      }
      res.json(rowToJson(rows[0]));
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/semantics/models — create (tenant-scoped: URN 유니크는 테넌트 단위)
router.post(
  "/models",
  writeGuard,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        res.status(403).json({ error: "no-tenant" });
        return;
      }
      const err = validateBody(req.body ?? {}, { requireUrn: true });
      if (err) {
        res.status(400).json({ error: err });
        return;
      }
      const b = req.body as Record<string, unknown>;
      const urn = (b.urn as string).trim();
      // 중복 검사도 테넌트 스코프 — 같은 URN을 서로 다른 테넌트가 가질 수 있다.
      const dup = await getPool().query(
        `SELECT 1 FROM semantic_models WHERE tenant_id = $1 AND urn = $2`,
        [tenantId, urn]
      );
      if (dup.rowCount && dup.rowCount > 0) {
        res.status(409).json({ error: "duplicate-urn" });
        return;
      }
      const { rows } = await getPool().query<SemanticModelRow>(
        `INSERT INTO semantic_models (tenant_id, urn, name, version, status, model_type, content, description_ko, description_en)
       VALUES ($1, $2, $3, $4, COALESCE($5, 'DRAFT'), COALESCE($6, 'SAMM'), COALESCE($7, ''), COALESCE($8, ''), COALESCE($9, ''))
       RETURNING *`,
        [
          tenantId,
          urn,
          (b.name as string).trim(),
          (b.version as string | null) ?? "",
          (b.status as string | null) ?? null,
          (b.modelType as string | null) ?? null,
          (b.content as string | null) ?? null,
          (b.descriptionKo as string | null) ?? null,
          (b.descriptionEn as string | null) ?? null,
        ]
      );
      res.status(201).json(rowToJson(rows[0]));
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/semantics/models/:urn — replace (tenant-scoped)
router.put(
  "/models/:urn",
  writeGuard,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        res.status(403).json({ error: "no-tenant" });
        return;
      }
      const urn = decodeURIComponent(req.params.urn);
      const err = validateBody(req.body ?? {}, { requireUrn: false });
      if (err) {
        res.status(400).json({ error: err });
        return;
      }
      const b = req.body as Record<string, unknown>;
      const { rows } = await getPool().query<SemanticModelRow>(
        `UPDATE semantic_models
       SET name = $3,
           version = COALESCE($4, version),
           status = COALESCE($5, status),
           model_type = COALESCE($6, model_type),
           content = COALESCE($7, content),
           description_ko = COALESCE($8, description_ko),
           description_en = COALESCE($9, description_en),
           updated_at = NOW()
       WHERE tenant_id = $1 AND urn = $2
       RETURNING *`,
        [
          tenantId,
          urn,
          (b.name as string).trim(),
          (b.version as string | null) ?? null,
          (b.status as string | null) ?? null,
          (b.modelType as string | null) ?? null,
          (b.content as string | null) ?? null,
          (b.descriptionKo as string | null) ?? null,
          (b.descriptionEn as string | null) ?? null,
        ]
      );
      if (rows.length === 0) {
        res.status(404).json({ error: "not-found" });
        return;
      }
      res.json(rowToJson(rows[0]));
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/semantics/models/:urn (tenant-scoped)
router.delete(
  "/models/:urn",
  writeGuard,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.user?.tenantId;
      if (!tenantId) {
        res.status(403).json({ error: "no-tenant" });
        return;
      }
      const urn = decodeURIComponent(req.params.urn);
      const { rowCount } = await getPool().query(
        `DELETE FROM semantic_models WHERE tenant_id = $1 AND urn = $2`,
        [tenantId, urn]
      );
      if (!rowCount) {
        res.status(404).json({ error: "not-found" });
        return;
      }
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  }
);

export default router;
