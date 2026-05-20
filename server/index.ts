// KMX EDC — BFF Server (Express)
// Serves static files in production + API proxy routes for EDC Management API

import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import { errorHandler } from "./middleware/errorHandler.js";
import { authMiddleware } from "./middleware/auth.js";
import { validateConnectorId } from "./middleware/validation.js";
import { apiRateLimit } from "./middleware/rateLimit.js";
import { initDb } from "./lib/db.js";
import { startNotificationGenerator } from "./lib/notificationGenerator.js";

// Routes
import connectorsRouter from "./routes/connectors.js";
import healthRouter from "./routes/health.js";
import assetsRouter from "./routes/assets.js";
import policiesRouter from "./routes/policies.js";
import offeringsRouter from "./routes/offerings.js";
import catalogRouter from "./routes/catalog.js";
import negotiationsRouter from "./routes/negotiations.js";
import transfersRouter from "./routes/transfers.js";
import edrsRouter from "./routes/edrs.js";
import fleetRouter from "./routes/fleet.js";
import statsRouter from "./routes/stats.js";
import notificationsUiRouter from "./routes/notificationsUi.js";
import authRouter from "./routes/auth.js";
import vaultRouter from "./routes/vault.js";
import platformInfraRouter from "./routes/platformInfra.js";
import systemRouter from "./routes/system.js";
import settingsRouter from "./routes/settings.js";
import identityHubRouter from "./routes/identityHub.js";
import shellsRouter from "./routes/shells.js";
import submodelsRouter from "./routes/submodels.js";
import semanticsRouter from "./routes/semantics.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  // ── Database Initialization ────────────────────────────────────
  await initDb();

  const app = express();
  const server = createServer(app);

  // ── Security Middleware ─────────────────────────────────────────
  // JSON body parsing — larger limit only for semantic models (SAMM TTL up to ~256 KB).
  // All other routes keep a tight 10 KB cap to limit DoS exposure.
  app.use("/api/semantics", express.json({ limit: "1mb" }));
  app.use(express.json({ limit: "10kb" }));

  // Security headers
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=(), payment=()");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    if (process.env.NODE_ENV === "production") {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
      // 프로덕션 CSP: 인라인 스크립트 차단 (Vite dev에서는 제외)
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'"
      );
    }
    next();
  });

  // 모든 /api 경로에 일반 rate limit (DoS 차단)
  app.use("/api", apiRateLimit);

  // Public auth routes (login/logout) — mounted BEFORE the auth middleware
  app.use("/api/auth", authRouter);

  // Authentication (all remaining /api/* routes)
  app.use("/api", authMiddleware);

  // Connector ID validation
  app.use("/api/connectors/:id", validateConnectorId);

  // ── API Routes ────────────────────────────────────────────────
  app.use("/api/connectors", connectorsRouter);
  app.use("/api/connectors", healthRouter);
  app.use("/api/connectors", assetsRouter);
  app.use("/api/connectors", policiesRouter);
  app.use("/api/connectors", offeringsRouter);
  app.use("/api/connectors", catalogRouter);
  app.use("/api/connectors", negotiationsRouter);
  app.use("/api/connectors", transfersRouter);
  app.use("/api/connectors", edrsRouter);
  app.use("/api/connectors", statsRouter);
  app.use("/api/notifications", notificationsUiRouter);
  app.use("/api/fleet", fleetRouter);
  app.use("/api/platform/vault", vaultRouter);
  app.use("/api/platform/postgres", platformInfraRouter);
  app.use("/api/system", systemRouter);
  app.use("/api/system", settingsRouter);
  app.use("/api/identity-hub", identityHubRouter);
  // Tractus-X Digital Twin Registry — global (connector-agnostic)
  app.use("/api/dtr", shellsRouter);
  app.use("/api/dtr", submodelsRouter);
  // Tractus-X Semantic Models — local Postgres CRUD
  app.use("/api/semantics", semanticsRouter);

  // Error handler (must be after routes)
  app.use(errorHandler);

  // ── Static Files (Production) ─────────────────────────────────
  const staticPath =
    process.env.NODE_ENV === "production"
      ? path.resolve(__dirname, "public")
      : path.resolve(__dirname, "..", "dist", "public");

  app.use(express.static(staticPath));

  // Handle client-side routing
  app.get("*", (_req, res) => {
    res.sendFile(path.join(staticPath, "index.html"));
  });

  const port = process.env.PORT || 3001;

  server.listen(port, () => {
    console.log(`[BFF] KMX EDC API server running on http://localhost:${port}/`);
  });

  // Background watcher for system-event notifications (negotiation TERMINATED,
  // transfer COMPLETED/TERMINATED, EDR expiring, VC expiring, connector unreachable).
  startNotificationGenerator().catch((err) =>
    console.error("[NotifyGen] failed to start:", err)
  );
}

startServer().catch(console.error);
