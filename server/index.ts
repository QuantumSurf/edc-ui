// KMX EDC — BFF Server (Express)
// Serves static files in production + API proxy routes for EDC Management API

import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import { errorHandler } from "./middleware/errorHandler.js";
import { authMiddleware } from "./middleware/auth.js";
import { validateConnectorId } from "./middleware/validation.js";
import { requireConnectorOwnership } from "./middleware/tenant.js";
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

  // trust proxy 설정 — 리버스 프록시(nginx Ingress) 뒤에서 req.ip가 항상 프록시 IP가 되어
  // IP 기반 rate limiter(특히 로그인 잠금)가 전역 단일 키로 무력화되는 문제 방지(id 63).
  // TRUST_PROXY로 신뢰 프록시 홉 수를 제어. 기본값은 안전(0=신뢰 안 함, X-Forwarded-For 무시).
  //   - 숫자(예: "1"): 신뢰할 프록시 홉 수(가장 가까운 N개) — 일반적 nginx 단일 프록시면 "1".
  //   - "true": 모든 프록시 신뢰(스푸핑 위험, 비권장).
  // [배포 결정 필요] 실제 프록시 홉 수에 맞춰 TRUST_PROXY를 설정해야 rate limit이 클라 IP 단위로 동작.
  const trustProxyEnv = process.env.TRUST_PROXY;
  if (trustProxyEnv != null && trustProxyEnv !== "") {
    const asNum = Number(trustProxyEnv);
    app.set(
      "trust proxy",
      trustProxyEnv === "true"
        ? true
        : Number.isFinite(asNum)
          ? asNum
          : trustProxyEnv // ip/subnet 문자열도 그대로 위임
    );
  } else {
    // 기본 안전값: 프록시 미신뢰(X-Forwarded-* 무시) → req.ip는 소켓 peer IP.
    app.set("trust proxy", false);
  }

  // ── Security Middleware ─────────────────────────────────────────
  // JSON body parsing — larger limit only for semantic models (SAMM TTL).
  // 실효 한계는 semantics.validateBody의 content 256KB(>256KB면 400 "content-too-large").
  // express 1mb는 JSON 엔벨로프(name/설명 등) 헤드룸을 둔 외곽 가드(>1mb면 413).
  // [클라 계약 — id 42] 클라는 413(외곽) / 400+"content-too-large"(content) 둘 다 "최대 256 KB"로
  // 안내해야 메시지·검증이 일치한다. (서버 실효 한계=256KB)
  app.use("/api/semantics", express.json({ limit: "1mb" }));
  app.use(express.json({ limit: "10kb" }));

  // Security headers
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader(
      "Permissions-Policy",
      "geolocation=(), microphone=(), camera=(), payment=()"
    );
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    if (process.env.NODE_ENV === "production") {
      res.setHeader(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains"
      );
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
  // Tenant isolation: the user's tenant must own the connector (covers all sub-routes)
  app.use("/api/connectors/:id", requireConnectorOwnership);

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
    console.log(
      `[BFF] KMX EDC API server running on http://localhost:${port}/`
    );
  });

  // Background watcher for system-event notifications (negotiation TERMINATED,
  // transfer COMPLETED/TERMINATED, EDR expiring, VC expiring, connector unreachable).
  startNotificationGenerator().catch(err =>
    console.error("[NotifyGen] failed to start:", err)
  );
}

startServer().catch(console.error);
