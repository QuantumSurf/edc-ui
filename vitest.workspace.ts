import { defineWorkspace } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

// vite.config.ts 는 root:client 라 vitest 가 client/ 만 스캔해 서버 테스트를 발견하지 못한다.
// 이 워크스페이스로 client(jsdom)·server(node) 두 프로젝트를 repo 루트 기준으로 모두 스캔한다.
const alias = { "@": path.resolve(import.meta.dirname, "client", "src") };

export default defineWorkspace([
  {
    plugins: [react()],
    resolve: { alias },
    test: {
      name: "client",
      environment: "jsdom",
      setupFiles: ["./client/src/test/setup.ts"],
      include: ["client/src/**/*.test.{ts,tsx}"],
      globals: true,
      css: false,
    },
  },
  {
    resolve: { alias },
    test: {
      name: "server",
      environment: "node",
      include: ["server/**/*.test.ts"],
      // 통합테스트(testcontainers+Docker)는 별도 project(integration)로 분리 — 기본 단위
      // 스위트는 Docker 없이 빠르게 돈다.
      exclude: ["**/node_modules/**", "**/dist/**", "server/test/integration/**"],
      globals: true,
    },
  },
  {
    // 통합테스트 — testcontainers 로 Postgres 를 띄워 실제 앱 격리를 검증(Docker 필요).
    // 명시적으로 `pnpm test:integration` 으로만 실행(기본 `test` 에서 제외).
    resolve: { alias },
    test: {
      name: "integration",
      environment: "node",
      include: ["server/test/integration/**/*.test.ts"],
      globals: true,
      testTimeout: 30_000,
      hookTimeout: 180_000,
    },
  },
]);
