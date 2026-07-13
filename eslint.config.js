// KMX EDC — ESLint 9 flat config
// client(브라우저/React 19)와 server(Node/Express)를 분리 적용한다.
// 성숙한 기존 코드베이스라 '진짜 버그'만 error 로 두고, 스타일·노이즈성 규칙은 warn 으로 완화한다
// (포매팅은 prettier 담당 — 여기서 스타일 규칙은 다루지 않는다).

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "coverage/**",
      "patches/**",
      "dev-mock/**",
      "**/*.cjs",
      "vite.config.ts",
      "test_bff.js", // 루트 ad-hoc 수동 테스트 스크립트(CJS) — 앱 코드 아님
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // 공통 완화 — 기존 코드에 광범위한 any/unused(_prefix) 가 있어 게이트를 막지 않도록 warn.
    rules: {
      // TS 컴파일러가 undefined 참조를 이미 검사하므로 no-undef 는 끈다(typescript-eslint 공식 권고).
      // 켜두면 console/Buffer/process 등 환경 전역에 대해 false positive 를 낸다.
      "no-undef": "off",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "no-empty": ["warn", { allowEmptyCatch: true }],
    },
  },
  {
    // 클라이언트(React) — 훅 규칙은 실제 버그를 잡으므로 error 유지.
    files: ["client/**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  },
  {
    // 서버(Node/Express)
    files: ["server/**/*.ts"],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // 테스트 파일
    files: ["**/*.test.{ts,tsx}", "server/test/**/*.ts"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  }
);
