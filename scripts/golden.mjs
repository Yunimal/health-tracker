#!/usr/bin/env node
// 골든 채점 러너 래퍼. `--case`/`--runs` 를 env 로 바꿔 vitest 에 넘긴다.
//   pnpm test:golden                      → 전체 18건 1회
//   pnpm test:golden -- --case case-005    → case-005 만 (1 API call)
//   pnpm test:golden -- --case case-005 --runs 3  → case-005 을 3회 반복(비결정성 확인)
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : undefined;
};

const env = { ...process.env };
const only = flag("--case");
const runs = flag("--runs");
if (only) env.GOLDEN_CASE = only;
if (runs) env.GOLDEN_RUNS = runs;

const res = spawnSync("pnpm", ["exec", "vitest", "run", "--config", "vitest.golden.config.ts"], {
  stdio: "inherit",
  env,
  shell: true,
});
process.exit(res.status ?? 1);
