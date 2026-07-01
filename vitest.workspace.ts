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
      globals: true,
    },
  },
]);
