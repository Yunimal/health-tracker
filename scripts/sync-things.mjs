#!/usr/bin/env node
/**
 * 이벤트 집계 기반 things 동기화 스크립트.
 *
 * 이미 구조화된 이벤트 payload 에서 이름을 읽어 things 를 등록한다.
 * LLM 호출 없음 — 결정적이고 무료다.
 *
 * 대상 카테고리 및 기본 임계값 (DEFAULT_MIN_DAYS):
 *   food        5일  — 그날 메뉴 제외, 습관적으로 먹는 것만
 *   medication  2일  — 가끔 먹어도 효과·부작용 관찰 대상
 *   activity    2일  — 반복 운동만
 *   body_care   2일  — 루틴화한 관리만
 *
 * 사용:
 *   pnpm sync-things -- --dry-run                등록될 목록만 출력, 실제 쓰기 없음
 *   pnpm sync-things -- --user 나                 특정 사용자만
 *   pnpm sync-things -- --min-days 3              전체 임계값 3일로 통일 (실험용)
 *   pnpm sync-things -- --min-days-food 7         food 만 7일로 조정
 *   pnpm sync-things -- --min-days-medication 3   medication 만 3일로 조정
 *   pnpm sync-things -- --min-days-activity 3     activity 만 3일로 조정
 *   pnpm sync-things -- --min-days-body-care 3    body_care 만 3일로 조정
 *   pnpm sync-things                              전체 동기화 실행
 *
 * --min-days 는 카테고리별 옵션을 모두 무시하는 전체 override 다.
 *
 * .env.local 을 읽어 실행된다. SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 필요.
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

function parseDaysArg(argv, i, flagName) {
  const n = Number(argv[i]);
  if (!Number.isInteger(n) || n < 1) {
    console.error(`${flagName} 는 1 이상의 정수여야 합니다`);
    process.exit(1);
  }
  return n;
}

function parseArgs(argv) {
  const args = {
    dryRun: false,
    user: null,
    minDays: null,        // null = 카테고리별 기본값 사용
    minDaysFood: null,
    minDaysMedication: null,
    minDaysActivity: null,
    minDaysBodyCare: null,
  };
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
    } else if (a === "--min-days") {
      args.minDays = parseDaysArg(argv, ++i, "--min-days");
    } else if (a === "--min-days-food") {
      args.minDaysFood = parseDaysArg(argv, ++i, "--min-days-food");
    } else if (a === "--min-days-medication") {
      args.minDaysMedication = parseDaysArg(argv, ++i, "--min-days-medication");
    } else if (a === "--min-days-activity") {
      args.minDaysActivity = parseDaysArg(argv, ++i, "--min-days-activity");
    } else if (a === "--min-days-body-care") {
      args.minDaysBodyCare = parseDaysArg(argv, ++i, "--min-days-body-care");
    } else {
      console.error(`알 수 없는 옵션: ${a}`);
      process.exit(1);
    }
  }
  return args;
}

const STATUS_ICON = { new: "+", merged: "→", blocked: "✕" };
const STATUS_LABEL = { new: "새로 추가", merged: "기존 병합", blocked: "차단" };

const CATEGORY_ORDER = ["food", "medication", "activity", "body_care"];
const CATEGORY_LABEL = {
  food: "음식",
  medication: "약·영양제",
  activity: "운동",
  body_care: "신체관리",
};

async function main() {
  loadEnvLocal();
  const args = parseArgs(process.argv.slice(2));

  const unregister = register();
  try {
    const { syncThingsFromEvents, resolveThresholds } =
      await import("../src/lib/things/sync-from-events.ts");

    const supabase = createClient(reqEnv("SUPABASE_URL"), reqEnv("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 사용자 목록 조회
    const { data: users, error: uErr } = await supabase.from("app_users").select("id, label");
    if (uErr) throw new Error(`app_users 조회 실패: ${uErr.message}`);

    // --user 필터
    let targetUsers = users;
    if (args.user) {
      targetUsers = users.filter((u) => u.label === args.user);
      if (targetUsers.length === 0) {
        const labels = users.map((u) => u.label).join(", ") || "(없음)";
        throw new Error(`--user '${args.user}' 에 해당하는 사용자가 없습니다. 있는 label: ${labels}`);
      }
    }

    // 실제 사용할 임계값 계산 (표시용)
    const categoryOverrides = {};
    if (args.minDaysFood != null)       categoryOverrides.food = args.minDaysFood;
    if (args.minDaysMedication != null) categoryOverrides.medication = args.minDaysMedication;
    if (args.minDaysActivity != null)   categoryOverrides.activity = args.minDaysActivity;
    if (args.minDaysBodyCare != null)   categoryOverrides.body_care = args.minDaysBodyCare;

    const syncOpts = {
      dryRun: args.dryRun,
      ...(args.minDays != null
        ? { minDays: args.minDays }
        : { minDaysByCategory: categoryOverrides }),
    };

    // 표시용 임계값 (resolveThresholds 는 syncThingsFromEvents 내부와 동일 로직)
    const displayThresholds = resolveThresholds({
      minDays: args.minDays,
      minDaysByCategory: categoryOverrides,
    });

    const thresholdSummary = args.minDays != null
      ? `전체 ${args.minDays}일 이상 (override)`
      : CATEGORY_ORDER.map((c) => `${CATEGORY_LABEL[c]} ${displayThresholds[c]}일`).join(" · ");

    console.log(
      `이벤트 집계 기반 things 동기화` +
      (args.user ? ` | 사용자: ${args.user}` : ` | 전체 ${targetUsers.length}명`) +
      (args.dryRun ? " | [DRY-RUN]" : ""),
    );
    console.log(`임계값: ${thresholdSummary}`);
    console.log("");

    let totalCreated = 0;
    let totalMerged = 0;
    let totalBlocked = 0;
    let totalMentions = 0;

    for (const user of targetUsers) {
      const result = await syncThingsFromEvents(supabase, user.id, syncOpts);

      if (result.candidates.length === 0) {
        console.log(`[${user.label}] 등록 기준을 넘은 후보 없음`);
        console.log("");
        continue;
      }

      const nonBlocked = result.candidates.filter((c) => c.status !== "blocked");
      console.log(
        `[${user.label}] 후보 ${nonBlocked.length}개` +
        (result.blocked > 0 ? ` (차단 ${result.blocked}개 제외)` : ""),
      );

      // 카테고리별로 그룹 출력
      for (const cat of CATEGORY_ORDER) {
        const group = result.candidates.filter((c) => c.category === cat);
        if (group.length === 0) continue;

        const threshold = result.thresholds[cat];
        const catLabel = CATEGORY_LABEL[cat] ?? cat;
        console.log(`\n  ── ${catLabel} (${cat})  ${threshold}일 이상 ──`);

        for (const c of group) {
          const icon = STATUS_ICON[c.status] ?? "?";
          const label = STATUS_LABEL[c.status] ?? c.status;
          console.log(
            `    ${icon} ${c.name}  ${c.distinctDays}일 · ${c.rawEntryIds.length}건  (${label})`,
          );
        }
      }

      console.log(
        `\n  요약: 새로 추가 ${result.created} · 기존 병합 ${result.merged}` +
        ` · 차단 ${result.blocked} · mention ${result.mentionsAdded}건` +
        (args.dryRun ? " (예상)" : ""),
      );
      console.log("");

      totalCreated += result.created;
      totalMerged += result.merged;
      totalBlocked += result.blocked;
      totalMentions += result.mentionsAdded;
    }

    if (targetUsers.length > 1) {
      console.log(
        `전체 요약: 새로 추가 ${totalCreated} · 기존 병합 ${totalMerged}` +
        ` · 차단 ${totalBlocked} · mention ${totalMentions}건` +
        (args.dryRun ? " (예상)" : ""),
      );
    }

    if (args.dryRun) {
      console.log("[dry-run] 실제 쓰기 없이 종료합니다. 기준이 적절하면 --dry-run 없이 다시 실행하세요.");
    }
  } finally {
    unregister();
  }
}

main().catch((e) => {
  console.error("치명적 오류:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
