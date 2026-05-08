// KMX EDC — Platform Infrastructure stats (PostgreSQL)
//
// Endpoints (RBAC-gated):
//   GET /api/platform/postgres/overview   — version, uptime, cluster info
//   GET /api/platform/postgres/databases  — DB list with size, connection count
//   GET /api/platform/postgres/connections — active sessions per DB / state
//   GET /api/platform/postgres/locks      — waiting/granted lock count
//
// Data source: pg_catalog views only (read-only). No mutations exposed.
//
// Security:
//   - Single shared read-only role expected (PLATFORM_DATABASE_URL).
//   - Endpoints don't expose individual query text (privacy / NF-23).

import { Router, type Request, type Response, type NextFunction } from "express";
import { requireRole } from "../middleware/auth.js";
import { getPlatformPool } from "../lib/platform.js";

const router = Router();

/* ─── /overview ─────────────────────────────────────────────── */
router.get(
  "/overview",
  requireRole("admin", "operator", "viewer"),
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const pool = getPlatformPool();
      const [verRes, upRes, settingsRes] = await Promise.all([
        pool.query("SELECT version() AS version"),
        pool.query("SELECT extract(epoch FROM (now() - pg_postmaster_start_time()))::bigint AS uptime_seconds"),
        pool.query(`
          SELECT name, setting FROM pg_settings
          WHERE name IN ('max_connections','shared_buffers','effective_cache_size','wal_level','work_mem')
        `),
      ]);
      const settings = Object.fromEntries(
        (settingsRes.rows as { name: string; setting: string }[]).map((r) => [r.name, r.setting])
      );
      res.json({
        version: verRes.rows[0]?.version ?? "unknown",
        uptimeSeconds: Number(upRes.rows[0]?.uptime_seconds ?? 0),
        settings,
      });
    } catch (error) {
      next(error);
    }
  }
);

/* ─── /databases ────────────────────────────────────────────── */
router.get(
  "/databases",
  requireRole("admin", "operator", "viewer"),
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const pool = getPlatformPool();
      const r = await pool.query(`
        SELECT
          d.datname AS name,
          pg_database_size(d.datname) AS size_bytes,
          (SELECT count(*) FROM pg_stat_activity a WHERE a.datname = d.datname) AS connections,
          pg_get_userbyid(d.datdba) AS owner
        FROM pg_database d
        WHERE NOT d.datistemplate
          AND d.datname NOT IN ('postgres')
        ORDER BY d.datname
      `);
      res.json({
        databases: r.rows.map((row: { name: string; size_bytes: string; connections: string; owner: string }) => ({
          name: row.name,
          sizeBytes: Number(row.size_bytes),
          connections: Number(row.connections),
          owner: row.owner,
        })),
      });
    } catch (error) {
      next(error);
    }
  }
);

/* ─── /connections ──────────────────────────────────────────── */
router.get(
  "/connections",
  requireRole("admin", "operator"),
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const pool = getPlatformPool();
      const r = await pool.query(`
        SELECT
          datname,
          state,
          count(*)::int AS count
        FROM pg_stat_activity
        WHERE datname IS NOT NULL
        GROUP BY datname, state
        ORDER BY datname, state
      `);
      res.json({ groups: r.rows });
    } catch (error) {
      next(error);
    }
  }
);

/* ─── /locks ────────────────────────────────────────────────── */
router.get(
  "/locks",
  requireRole("admin", "operator"),
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const pool = getPlatformPool();
      const r = await pool.query(`
        SELECT
          (SELECT count(*) FROM pg_locks WHERE granted) AS granted,
          (SELECT count(*) FROM pg_locks WHERE NOT granted) AS waiting
      `);
      const row = r.rows[0] as { granted: string; waiting: string } | undefined;
      res.json({
        granted: Number(row?.granted ?? 0),
        waiting: Number(row?.waiting ?? 0),
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
