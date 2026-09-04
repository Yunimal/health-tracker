#!/usr/bin/env node
/**
 * thing-extract SYSTEM 프롬프트 검증용 1회 호출 스크립트.
 * pnpm 없이 직접: node --import tsx/esm scripts/test-thing-extract.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { register } from "tsx/esm/api";

function loadEnvLocal() {
  const path = join(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const TRANSCRIPTS = [
  // 목표: 쥬베룩(treatment) + 보톡스(treatment) 추출
  "오늘 쥬베룩 스킨(볼쪽), 보톡스(팔자) 2회차 다녀옴",
  // 오탐 방지: 감탄사가 place 로 잡히지 않아야 함
  "오늘 날씨 진짜 샤갈이야. 기분도 별로고 저녁엔 국밥 먹었어.",
  // 범위 축소: 음식·약 이름을 뽑지 않아야 함
  "아침에 유산균이랑 비타민D 챙겨 먹었어. 저녁엔 산책 30분 했고.",
];

loadEnvLocal();
const unregister = register();

try {
  const { extractThings } = await import("../src/lib/parser/thing-extract.ts");

  for (const transcript of TRANSCRIPTS) {
    console.log("─".repeat(60));
    console.log(`원문: ${transcript}`);
    const result = await extractThings(transcript);
    if (result.length === 0) {
      console.log("추출 결과: (없음)");
    } else {
      for (const t of result) {
        console.log(`  • ${t.kind.padEnd(10)} ${t.name}  |  "${t.excerpt}"`);
      }
    }
    console.log();
  }
} finally {
  unregister();
}
