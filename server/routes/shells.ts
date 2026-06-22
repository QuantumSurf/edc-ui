// KMX EDC — Digital Twin Registry: Shell Descriptor Routes
// Proxies to tractusx/sldt-digital-twin-registry under /api/v3.

import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import {
  getDtrClient,
  encodeAasId,
  mapShellDescriptor,
} from "../lib/dtrClient.js";
import { requireRole } from "../middleware/auth.js";

const router = Router();
const writeGuard = requireRole("admin", "operator");

// GET /api/dtr/shells — list shell descriptors (paginated)
router.get(
  "/shells",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const client = getDtrClient();
      const { limit, cursor } = req.query;
      const params: Record<string, string> = {};
      if (limit) params.limit = String(limit);
      if (cursor) params.cursor = String(cursor);
      const { data } = await client.get("/shell-descriptors", { params });
      const items = Array.isArray(data?.result)
        ? data.result.map(mapShellDescriptor)
        : [];
      res.json({
        items,
        cursor: data?.paging_metadata?.cursor ?? null,
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/dtr/shells/:aasId — fetch single shell descriptor (mapped)
router.get(
  "/shells/:aasId",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const client = getDtrClient();
      const id = encodeAasId(req.params.aasId);
      const { data } = await client.get(`/shell-descriptors/${id}`);
      res.json(mapShellDescriptor(data));
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/dtr/shells/:aasId/raw — fetch raw DTR shell payload (for editor pre-fill)
router.get(
  "/shells/:aasId/raw",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const client = getDtrClient();
      const id = encodeAasId(req.params.aasId);
      const { data } = await client.get(`/shell-descriptors/${id}`);
      res.json(data);
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/dtr/shells — create shell descriptor (raw AAS body passthrough)
router.post(
  "/shells",
  writeGuard,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const client = getDtrClient();
      const { data } = await client.post("/shell-descriptors", req.body);
      res.status(201).json(mapShellDescriptor(data));
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/dtr/shells/:aasId — replace shell descriptor
router.put(
  "/shells/:aasId",
  writeGuard,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const client = getDtrClient();
      const id = encodeAasId(req.params.aasId);
      await client.put(`/shell-descriptors/${id}`, req.body);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/dtr/shells/:aasId — delete shell descriptor
router.delete(
  "/shells/:aasId",
  writeGuard,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const client = getDtrClient();
      const id = encodeAasId(req.params.aasId);
      await client.delete(`/shell-descriptors/${id}`);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/dtr/lookup — search shells by specificAssetIds
// Body: { assetIds: [{ name, value }] }
router.post(
  "/lookup",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const client = getDtrClient();
      const assetIds = (req.body?.assetIds ?? []) as Array<{
        name: string;
        value: string;
      }>;
      const { data } = await client.post("/lookup/shells", { assetIds });
      res.json({ shellIds: Array.isArray(data?.result) ? data.result : [] });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
