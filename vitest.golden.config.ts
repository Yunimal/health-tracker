import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";

// 골든 채점 전용 설정. 실제 API 를 호출하므로 이 설정으로만(=pnpm test:golden) 돈다.
// 기본 vitest.config.ts 는 tests/parser.golden.test.ts 를 exclude 한다.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/parser.golden.test.ts"],
    testTimeout: 600000, // 10분: 여러 케이스를 순차로 실제 파싱
    hookTimeout: 600000,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
