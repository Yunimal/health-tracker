#!/usr/bin/env node
/**
 * 대상 추출 재실행 스크립트 (thing_extract_version 을 올린 뒤 실행).
 *
 * 파싱(pnpm reparse)과 독립된 별도 경로:
 *  - thing_extract_version 이 현재 THING_EXTRACT_VERSION 과 다른(또는 null인) 원문만 대상.
 *  - events / hypotheses 는 건드리지 않는다. 대상 추출(things / thing_mentions)만 갱신.
 *  - LLM 호출은 thing-extract 프롬프트 1회뿐 (파싱 LLM 호출 없음).
 *
 * 사용:
 *   pnpm extract-things -- --dry-run         대상 건수·분포만 출력, 실제 호출 없음
 *   pnpm extract-things -- --user 나         특정 사용자(app_users.label)만
 *   pnpm extract-things -- --limit 20        최대 20 건만 (비용 통제)
 *   pnpm extract-things -- --delay 2000      호출 사이 지연 ms (기본 1000)
 *   pnpm extract-things                      대상 전체 재추출
 *
 * .env.local 을 읽어 실행된다. SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / ANTHROPIC_API_KEY 필요.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { register } from "tsx/esm/api";

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

/** argv 파싱. "--" 는 pnpm 이 삽입하는 구분자이므로 무시한다. */
function parseArgs(rawArgv) {
  const argv = rawArgv.filter((a) => a !== "--");
  const args = { dryRun: false, user: null, limit: null, delay: 1000 };
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
    } else if (a === "--delay") {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n < 0) {
        console.error("--delay 는 0 이상의 정수(밀리초)여야 합니다");
        process.exit(1);
      }
      args.delay = n;
    } else {
      console.error(`알 수 없는 옵션: ${a}`);
      process.exit(1);
    }
  }
  return args;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 레이트 리밋 에러인지 판별한다. */
function isRateLimitError(err) {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("429") ||
    msg.toLowerCase().includes("rate_limit") ||
    msg.toLowerCase().includes("rate limit")
  );
}

/** 크레딧 부족 에러인지 판별한다. 재시도해도 같은 결과이므로 즉시 전체 중단한다. */
function isCreditError(err) {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.toLowerCase().includes("credit");
}

/**
 * 레이트 리밋 오류 시 지수 백오프로 재시도한다.
 * 크레딧 부족 오류는 재시도 없이 즉시 던진다(호출부에서 전체 중단).
 * 그 외 오류도 즉시 던진다.
 * 대기: 2s → 4s → 8s (maxRetries=3 이면 최대 2회 재시도).
 */
async function withBackoff(fn, maxRetries = 3) {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      if (isCreditError(err)) throw err; // 재시도 없이 즉시 던진다
      attempt++;
      if (!isRateLimitError(err) || attempt >= maxRetries) throw err;
      const waitMs = Math.pow(2, attempt) * 1000;
      console.log(`  → 레이트 리밋 감지, ${waitMs / 1000}초 후 재시도 (${attempt}/${maxRetries})...`);
      await sleep(waitMs);
    }
  }
}

async function main() {
  loadEnvLocal();
  const args = parseArgs(process.argv.slice(2));

  const unregister = register();
  try {
    const { THING_EXTRACT_VERSION, persistThings } =
      await import("../src/lib/parser/thing-extract.ts");

    const supabase = createClient(reqEnv("SUPABASE_URL"), reqEnv("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 사용자 라벨 맵 (id → label)
    const { data: users, error: uErr } = await supabase.from("app_users").select("id, label");
    if (uErr) throw new Error(`app_users 조회 실패: ${uErr.message}`);
    const labelById = new Map(users.map((u) => [u.id, u.label]));

    // --user 필터
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

    // 대상 = thing_extract_version 이 null 이거나 현재 버전과 다른 원문.
    // hidden_at 을 가리지 않는다(숨긴 원문도 대상 추출은 최신화해 둔다).
    // 페이지네이션으로 전부 모은다.
    async function fetchTargets() {
      const rows = [];
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        let q = supabase
          .from("raw_entries")
          .select("id, user_id, transcript")
          .or(
            `thing_extract_version.is.null,thing_extract_version.neq.${THING_EXTRACT_VERSION}`,
          )
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

    // 사용자별 분포
    const distribution = new Map();
    for (const e of targets) {
      const label = labelById.get(e.user_id) ?? `(알 수 없음: ${e.user_id})`;
      distribution.set(label, (distribution.get(label) ?? 0) + 1);
    }

    console.log(`현재 THING_EXTRACT_VERSION = ${THING_EXTRACT_VERSION}`);
    console.log(
      `재추출 대상 ${targets.length} 건` +
        (args.user ? ` · 사용자 필터: ${args.user}` : "") +
        (args.limit && targets.length > args.limit ? ` · --limit ${args.limit} 적용` : ""),
    );
    for (const [label, n] of [...distribution].sort((a, b) => b[1] - a[1])) {
      console.log(`  - ${label}: ${n} 건`);
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

    console.log(`호출 간격: ${args.delay}ms (--delay 로 조정)`);

    let ok = 0;
    let rateLimitCount = 0;
    let otherFailCount = 0;
    const total = toProcess.length;

    for (let i = 0; i < total; i++) {
      // 첫 번째 호출 제외, 호출 사이에 지연을 넣어 레이트 리밋을 방지한다.
      if (i > 0 && args.delay > 0) await sleep(args.delay);

      const entry = toProcess[i];
      const label = labelById.get(entry.user_id) ?? entry.user_id;
      let creditAbort = false;
      try {
        const thingsCount = await withBackoff(() =>
          persistThings(supabase, entry.user_id, entry.id, entry.transcript),
        );
        ok++;
        console.log(
          `[${i + 1}/${total}] ${label} · ${entry.id} · 성공 (things ${thingsCount}건)`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (isCreditError(err)) {
          // 크레딧 부족: 이 건도 기록하고 전체 중단.
          otherFailCount++;
          await supabase.from("raw_entries").update({ thing_extract_error: msg }).eq("id", entry.id);
          const remaining = total - i - 1;
          console.error(
            `\n크레딧이 부족해 중단했습니다. 남은 ${remaining}건은 처리되지 않았습니다.`,
          );
          console.error(`오류: ${msg}`);
          creditAbort = true;
        } else {
          const isRateLimit = isRateLimitError(err);
          if (isRateLimit) {
            rateLimitCount++;
          } else {
            otherFailCount++;
          }
          console.log(
            `[${i + 1}/${total}] ${label} · ${entry.id} · 실패(${isRateLimit ? "레이트리밋" : "오류"}): ${msg}`,
          );
          // 실패 사유를 DB 에 기록한다. parse_error 와 같은 방식. (0017)
          // thing_extract_version 은 갱신하지 않아 다음 실행에서 다시 대상이 된다.
          await supabase.from("raw_entries").update({ thing_extract_error: msg }).eq("id", entry.id);
        }
      }
      if (creditAbort) break;
    }

    const failCount = rateLimitCount + otherFailCount;
    console.log(
      `\n요약: 처리 ${ok + failCount} 건 (성공 ${ok} · 실패 ${failCount})`,
    );
    if (failCount > 0) {
      if (rateLimitCount > 0) console.log(`  · 레이트 리밋: ${rateLimitCount} 건`);
      if (otherFailCount > 0) console.log(`  · 기타 오류(크레딧 포함): ${otherFailCount} 건`);
      console.log(
        `실패한 ${failCount} 건은 thing_extract_error 에 기록됨. ` +
          `다음 실행에서 다시 대상이 됩니다.`,
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
