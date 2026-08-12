import { describe, it, beforeAll, expect } from "vitest";
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseTranscript, PARSE_MODEL, PARSE_VERSION } from "@/lib/parser";
import {
  scoreCase,
  scoreSuite,
  toScoreSide,
  renderTable,
  type CaseResult,
  type SuiteReport,
} from "./golden/scorer";

/**
 * 골든 채점 스위트 — **실제 Anthropic API 를 호출한다.** CI 제외, 로컬 전용.
 * 전용 설정으로만 실행된다: `pnpm test:golden` (vitest.golden.config.ts).
 * 기본 `pnpm test` 는 이 파일을 exclude 한다.
 */

const GOLDEN_DIR = join(process.cwd(), "tests", "golden");
const RESULTS_DIR = join(GOLDEN_DIR, "results");

/** vitest 는 .env.local 을 자동 로드하지 않는다. 있으면 직접 읽어 넣는다. */
function loadEnvLocal(): void {
  const path = join(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
  }
}

function loadCases(): {
  name: string;
  input: { transcript: string; recorded_at: string };
  expected: unknown;
}[] {
  return readdirSync(GOLDEN_DIR)
    .filter((f) => /^case-\d+\.json$/.test(f))
    .sort()
    .map((f) => {
      const data = JSON.parse(readFileSync(join(GOLDEN_DIR, f), "utf8"));
      return { name: f.replace(/\.json$/, ""), input: data.input, expected: data.expected };
    });
}

async function runGoldenSuite(): Promise<SuiteReport> {
  loadEnvLocal();
  const cases = loadCases();
  const results: CaseResult[] = [];

  for (const c of cases) {
    // 발화당 1회 호출 원칙에 따라 순차 실행. (기획서 §10)
    let actual: ReturnType<typeof toScoreSide>;
    let error: string | undefined;
    try {
      const parsed = await parseTranscript(c.input.transcript, c.input.recorded_at);
      actual = toScoreSide(parsed);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      actual = { events: [], hypotheses: [] };
    }
    const expected = toScoreSide(c.expected as Parameters<typeof toScoreSide>[0]);
    results.push(scoreCase(c.name, expected, actual, error));
  }

  const report = scoreSuite(results, {
    parse_version: PARSE_VERSION,
    model: PARSE_MODEL,
    generated_at: new Date().toISOString(),
  });

  // 결과 저장: 모델명을 파일명에 넣어 모델 간 비교 가능.
  mkdirSync(RESULTS_DIR, { recursive: true });
  const safeModel = PARSE_MODEL.replace(/[^a-zA-Z0-9._-]/g, "_");
  const outPath = join(RESULTS_DIR, `${PARSE_VERSION}-${safeModel}.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n", "utf8");

  // 사람이 읽는 표.
  console.log("\n" + renderTable(report));
  console.log(`\n결과 저장: ${outPath}\n`);

  return report;
}

/** 오분류 케이스를 사람이 읽을 수 있게 요약한다(실패 메시지용). */
function misclassificationSummary(report: SuiteReport): string {
  const lines: string[] = [];
  for (const c of report.cases) {
    if (c.hypotheses.misclassifications === 0) continue;
    lines.push(`  ${c.name}:`);
    for (const h of c.hypotheses.missing)
      lines.push(`    - 누락된 가설(사실로 처리했거나 버림): "${h.statement}"`);
    for (const h of c.hypotheses.spurious)
      lines.push(`    - 잘못 만든 가설(사실이어야 함): "${h.statement}"`);
  }
  return lines.join("\n");
}

describe("골든 채점 (실제 API)", () => {
  let report: SuiteReport;

  beforeAll(async () => {
    report = await runGoldenSuite();
  });

  // §6.3: 가설/사실 오분류가 가장 중요한 지표. 1건이라도 있으면 FAIL.
  it("가설/사실 오분류 0건", () => {
    expect(
      report.totals.hypothesis_misclassifications,
      `가설/사실 오분류 ${report.totals.hypothesis_misclassifications}건:\n${misclassificationSummary(report)}`,
    ).toBe(0);
  });

  // 나머지 지표는 리포트만. FAIL 시키지 않는다(지금은 점수를 재는 게 목적).
  it("나머지 지표는 리포트만 (통과 목적 아님)", () => {
    const t = report.totals;
    console.log(
      `[참고] 이벤트 F1 ${(t.detection_f1 * 100).toFixed(0)}% · 카테고리 ${(t.category_accuracy * 100).toFixed(0)}% · occurred_at±1h ${(t.occurred_at_pass_rate * 100).toFixed(0)}%`,
    );
    expect(report.case_count).toBeGreaterThan(0);
  });
});
