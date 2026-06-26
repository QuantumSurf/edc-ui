import { jsxLocPlugin } from "@builder.io/vite-plugin-jsx-loc";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss(), jsxLocPlugin()],
  test: {
    environment: "jsdom",
    setupFiles: ["./client/src/test/setup.ts"],
    globals: true,
    css: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
    },
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port: process.env.PORT ? parseInt(process.env.PORT) : 3000,
    strictPort: false, // Will find next available port if 3000 is busy
    host: true,
    allowedHosts: ["localhost", "127.0.0.1"],
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
    // Windows host ↔ Linux container bind mount: inotify가 전파 안 돼 HMR이 죽는 경우
    // VITE_USE_POLLING=true 로 폴링 감시 활성화 (docker dev 전용, 기본은 native 감시).
    watch:
      process.env.VITE_USE_POLLING === "true"
        ? { usePolling: true, interval: 200 }
        : undefined,
    proxy: {
      "/api": {
        // dev compose에서는 BFF가 같은 컨테이너(localhost:3001)에 뜨므로 env로 타깃 재지정.
        target: process.env.BFF_PROXY_TARGET || "http://localhost:3003",
        changeOrigin: true,
      },
    },
  },
});
