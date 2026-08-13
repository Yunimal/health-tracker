#!/usr/bin/env node
/**
 * 전체 재파싱 관리 스크립트 (프롬프트 버전을 올린 뒤 실행).
 *
 * POST /api/parse 는 토큰 소유자의 원문만 재파싱하므로, 버전을 올릴 때마다 사용자 수만큼
 * 수동 호출해야 한다. 이 스크립트는 service_role 로 DB 에 직접 붙어 **전체 raw_entries** 중
 * parse_version 이 현재 PARSE_VERSION 과 다른 것만 골라 재파싱한다.
 *
 * ⚠️ HTTP 엔드포인트가 아니라 로컬 스크립트다 — 전체 재파싱은 관리 작업이지 사용자 기능이
 *    아니다. 엔드포인트로 열면 그 토큰이 새는 순간 전원 데이터를 건드릴 수 있다.
 *
 * 파싱/저장 로직은 앱과 **단일 원본**을 공유한다(reparseEntry, PARSE_VERSION). plain node 는
 * TS(+경로 별칭 @/)를 못 읽으므로, 골든 러너가 vitest 로 TS 를 도는 것처럼 여기서는 tsx 로더를
 * 등록한 뒤 TS 모듈을 동적 import 한다. (dev 전용 로더 — 앱 런타임 스택은 그대로다.)
 *
 * 사용:
 *   pnpm reparse                     대상 전체 재파싱
 *   pnpm reparse -- --dry-run        대상 건수·사용자별 분포만 출력(호출 없음)
 *   pnpm reparse -- --user 엄마       특정 사용자(app_users.label)만
 *   pnpm reparse -- --limit 20        최대 20 건만(비용 통제)
 *
 * .env.local 을 읽어 실행된다(골든 러너와 같은 방식). SUPABASE_URL /
 * SUPABASE_SERVICE_ROLE_KEY / ANTHROPIC_API_KEY 필요.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { register } from "tsx/esm/api";

/** vitest 는 .env.local 을 자동 로드하지 않는다. 골든 러너와 동일하게 직접 읽어 넣는다. */
function loadEnvLocal() {
  const path = join(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

function reqEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`환경 변수 누락: ${name} (.env.local 확인)`);
  return v;
}

/** argv 파싱. 알 수 없는 옵션/누락 값은 즉시 종료한다. */
function parseArgs(argv) {
  const args = { dryRun: false, user: null, limit: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") {
      args.dryRun = true;
    } else if (a === "--user") {
      const v = argv[++i];
      if (v == null || v.startsWith("--")) {
        console.error("--user 뒤에 사용자 label 이 필요합니다");
        process.exit(1);
      }
      args.user = v;
    } else if (a === "--limit") {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n <= 0) {
        console.error("--limit 은 양의 정수여야 합니다");
        process.exit(1);
      }
      args.limit = n;
    } else {
      console.error(`알 수 없는 옵션: ${a}`);
      process.exit(1);
    }
  }
  return args;
}

async function main() {
  loadEnvLocal();
  const args = parseArgs(process.argv.slice(2));

  // TS 파서 로직 재사용(단일 원본). tsx 로더 등록 후 동적 import 로 @/ 별칭까지 해석된다.
  // 로더 워커가 살아있는 동안 process.exit 하면 비정상 종료코드가 나므로, 아래는 throw 로
  // 오류를 올리고 finally 에서 unregister → main().catch 가 exitCode 를 세팅한다.
  const unregister = register();
  try {
    const { PARSE_VERSION, getApiCallCount, resetApiCallCount } =
      await import("../src/lib/parser/index.ts");
    const { reparseEntry } = await import("../src/lib/parser/persist.ts");

    const supabase = createClient(reqEnv("SUPABASE_URL"), reqEnv("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 사용자 라벨 맵 (id → label). 진행 출력·분포·--user 필터에 쓴다.
    const { data: users, error: uErr } = await supabase.from("app_users").select("id, label");
    if (uErr) throw new Error(`app_users 조회 실패: ${uErr.message}`);
    const labelById = new Map(users.map((u) => [u.id, u.label]));

    // --user 필터: label → user_id 목록.
    let userIdFilter = null;
    if (args.user) {
      const match = users.filter((u) => u.label === args.user);
      if (match.length === 0) {
        const labels = users.map((u) => u.label).join(", ") || "(없음)";
        throw new Error(
          `--user '${args.user}' 에 해당하는 사용자가 없습니다. 있는 label: ${labels}`,
        );
      }
      userIdFilter = match.map((u) => u.id);
    }

    // 대상: parse_version 이 현재와 다른 것(미파싱=null 포함). neq 는 null 을 놓치므로 or 로 잡는다.
    // 페이지네이션(1000행 기본 한계)으로 전부 모은다. created_at 오름차순 → 재실행 시 이어서 진행.
    async function fetchTargets() {
      const rows = [];
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        let q = supabase
          .from("raw_entries")
          .select("*")
          .or(`parse_version.is.null,parse_version.neq.${PARSE_VERSION}`)
          .order("created_at", { ascending: true })
          .range(from, from + PAGE - 1);
        if (userIdFilter) q = q.in("user_id", userIdFilter);
        const { data, error } = await q;
        if (error) throw new Error(`대상 조회 실패: ${error.message}`);
        rows.push(...data);
        if (data.length < PAGE) break;
      }
      return rows;
    }

    const targets = await fetchTargets();

    // 사용자별 분포.
    const distribution = new Map();
    for (const e of targets) {
      const label = labelById.get(e.user_id) ?? `(알 수 없음: ${e.user_id})`;
      distribution.set(label, (distribution.get(label) ?? 0) + 1);
    }

    console.log(`현재 PARSE_VERSION = ${PARSE_VERSION}`);
    console.log(
      `버전 불일치(재파싱 대상): ${targets.length} 건` +
        (args.user ? ` · 사용자 필터: ${args.user}` : ""),
    );
    for (const [label, n] of [...distribution].sort((a, b) => b[1] - a[1])) {
      console.log(`  - ${label}: ${n} 건`);
    }
    if (args.limit && targets.length > args.limit) {
      console.log(`--limit ${args.limit} → 앞에서 ${args.limit} 건만 처리`);
    }

    if (args.dryRun) {
      console.log("\n[dry-run] 실제 호출 없이 종료합니다.");
      return;
    }

    const toProcess = args.limit ? targets.slice(0, args.limit) : targets;
    if (toProcess.length === 0) {
      console.log("처리할 대상이 없습니다.");
      return;
    }

    resetApiCallCount();
    let ok = 0;
    let failed = 0;
    const total = toProcess.length;
    for (let i = 0; i < total; i++) {
      const entry = toProcess[i];
      const label = labelById.get(entry.user_id) ?? entry.user_id;
      // 배치이므로 cachePrompt: true(같은 프롬프트로 연속 호출 — 캐시 이득).
      // 실패해도 reparseEntry 가 parse_error 에 기록하고 outcome 으로 돌려준다 — 멈추지 않고 계속.
      const outcome = await reparseEntry(supabase, entry.user_id, entry, { cachePrompt: true });
      if (outcome.ok) {
        ok++;
        console.log(
          `[${i + 1}/${total}] ${label} · ${entry.id} · 성공 ` +
            `(events ${outcome.events ?? 0}, hyp ${outcome.hypotheses ?? 0}, unparsed ${outcome.unparsed ?? 0})`,
        );
      } else {
        failed++;
        console.log(
          `[${i + 1}/${total}] ${label} · ${entry.id} · 실패: ${outcome.error ?? "알 수 없는 오류"}`,
        );
      }
    }

    console.log(
      `\n요약: 처리 ${ok + failed} 건 (성공 ${ok} · 실패 ${failed}) · API 호출 ${getApiCallCount()} 회`,
    );
    if (failed > 0) {
      console.log(
        `실패한 ${failed} 건은 raw_entries.parse_error 에 기록됨(원문은 불변). ` +
          `원인 해결 후 해당 건만 다시 파싱하려면 웹의 "다시 파싱" 또는 POST /api/parse 를 쓴다.`,
      );
    }
  } finally {
    unregister();
  }
}

main().catch((e) => {
  console.error("치명적 오류:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
