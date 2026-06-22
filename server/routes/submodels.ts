// KMX EDC — DTR: Submodel Descriptor Routes
// Path: /api/dtr/shells/:aasId/submodels[/:submodelId]

import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import {
  getDtrClient,
  encodeAasId,
  mapSubmodelDescriptor,
} from "../lib/dtrClient.js";
import { requireRole } from "../middleware/auth.js";

const router = Router();
const writeGuard = requireRole("admin", "operator");

// GET /api/dtr/shells/:aasId/submodels — list submodel descriptors of a shell
router.get(
  "/shells/:aasId/submodels",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const client = getDtrClient();
      const aas = encodeAasId(req.params.aasId);
      const { data } = await client.get(
        `/shell-descriptors/${aas}/submodel-descriptors`
      );
      const items = Array.isArray(data?.result)
        ? data.result.map(mapSubmodelDescriptor)
        : [];
      res.json({ items });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/dtr/shells/:aasId/submodels — create submodel descriptor
router.post(
  "/shells/:aasId/submodels",
  writeGuard,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const client = getDtrClient();
      const aas = encodeAasId(req.params.aasId);
      const { data } = await client.post(
        `/shell-descriptors/${aas}/submodel-descriptors`,
        req.body
      );
      res.status(201).json(mapSubmodelDescriptor(data));
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/dtr/shells/:aasId/submodels/:submodelId — replace submodel descriptor
router.put(
  "/shells/:aasId/submodels/:submodelId",
  writeGuard,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const client = getDtrClient();
      const aas = encodeAasId(req.params.aasId);
      const sub = encodeAasId(req.params.submodelId);
      await client.put(
        `/shell-descriptors/${aas}/submodel-descriptors/${sub}`,
        req.body
      );
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/dtr/shells/:aasId/submodels/:submodelId
router.delete(
  "/shells/:aasId/submodels/:submodelId",
  writeGuard,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const client = getDtrClient();
      const aas = encodeAasId(req.params.aasId);
      const sub = encodeAasId(req.params.submodelId);
      await client.delete(
        `/shell-descriptors/${aas}/submodel-descriptors/${sub}`
      );
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  }
);

export default router;
