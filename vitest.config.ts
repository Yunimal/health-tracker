import { defineConfig, configDefaults } from "vitest/config";
import { fileURLToPath } from "url";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    // 골든 채점기는 실제 API 를 호출하므로 기본 실행/CI 에서 제외. (pnpm test:golden 로만 실행)
    exclude: [...configDefaults.exclude, "tests/parser.golden.test.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
