import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildCandidates, syncThingsFromEvents } from "./sync-from-events";

// ── helpers ──────────────────────────────────────────────────────────────────

function makeEvent(
  rawEntryId: string,
  category: "food" | "medication" | "activity" | "body_care",
  payload: Record<string, unknown>,
  recordedAt: string,
) {
  return { raw_entry_id: rawEntryId, category, payload, recorded_at: recordedAt };
}

// 날짜를 UTC ISO 로 변환한다 (KST 자정 = UTC 15:00 전날).
// 테스트에서는 UTC 00:00 을 기준으로 쓰면 KST 날짜가 +1 이 되므로,
// 테스트 날짜를 KST 자정 기준(UTC 15:00)으로 명시한다.
const DAY1 = "2026-01-01T00:00:00+09:00"; // KST 2026-01-01 자정 → UTC 2025-12-31T15:00:00Z
const DAY2 = "2026-01-02T00:00:00+09:00"; // KST 2026-01-02 자정

// events 를 syncThingsFromEvents 에 주입하려면 from("events") 도 제어해야 한다.
type MockEvent = {
  raw_entry_id: string;
  category: string;
  payload: Record<string, unknown>;
  raw_entries: { recorded_at: string };
};

function makeMockFull(opts: {
  events: MockEvent[];
  existingThings: { id: string; kind: string; name: string; aliases: string[] }[];
  blocklist: { kind: string; normalized_name: string }[];
  mentionRows?: { created_at: string }[];
  newThingId?: string;
}) {
  const mentionRows = opts.mentionRows ?? [{ created_at: new Date().toISOString() }];
  const _upsertCalls: { table: string; rows: unknown[] }[] = [];
  const _insertCalls: { table: string; rows: unknown }[] = [];
  const _updateCalls: { table: string; vals: unknown }[] = [];

  const from = (table: string) => ({
    select: (_fields?: string) => ({
      eq: (_col: string, _val: unknown) => ({
        data:
          table === "things" ? opts.existingThings
          : table === "thing_blocklist" ? opts.blocklist
          : [],
        error: null,
        in: (_col2: string, _vals: unknown[]) => ({
          data: table === "events" ? opts.events : [],
          error: null,
        }),
        order: (_col2: string, _opts?: unknown) => ({
          data: table === "thing_mentions" ? mentionRows : [],
          error: null,
        }),
        single: () => ({ data: { note: null }, error: null }),
      }),
    }),
    insert: (rows: unknown) => {
      _insertCalls.push({ table, rows });
      return {
        select: () => ({
          single: () => ({
            data: { id: opts.newThingId ?? "new-thing-id" },
            error: null,
          }),
        }),
      };
    },
    upsert: (rows: unknown[]) => {
      _upsertCalls.push({ table, rows });
      return { error: null };
    },
    update: (vals: unknown) => {
      _updateCalls.push({ table, vals });
      return { eq: () => ({ error: null }) };
    },
    delete: () => ({ eq: () => ({ error: null }) }),
  });

  return {
    from: from as unknown as SupabaseClient["from"],
    _upsertCalls,
    _insertCalls,
    _updateCalls,
  } as unknown as SupabaseClient & {
    _upsertCalls: typeof _upsertCalls;
    _insertCalls: typeof _insertCalls;
    _updateCalls: typeof _updateCalls;
  };
}

// 모든 카테고리 임계값을 동일하게 설정하는 헬퍼 (buildCandidates 테스트용)
const ALL2 = { food: 2, medication: 2, activity: 2, body_care: 2 } as const;
const ALL1 = { food: 1, medication: 1, activity: 1, body_care: 1 } as const;

// ── buildCandidates (순수 함수) ───────────────────────────────────────────────

describe("buildCandidates", () => {
  it("같은 날 두 번 등장 → distinctDays=1, minDays=2 이면 제외", () => {
    const events = [
      makeEvent("e1", "food", { name: "비타민D", kind: "food" }, DAY1),
      makeEvent("e2", "food", { name: "비타민D", kind: "food" }, DAY1),
    ];
    expect(buildCandidates(events, ALL2)).toHaveLength(0);
  });

  it("서로 다른 이틀 등장 → distinctDays=2, minDays=2 이면 포함", () => {
    const events = [
      makeEvent("e1", "food", { name: "비타민D", kind: "food" }, DAY1),
      makeEvent("e2", "food", { name: "비타민D", kind: "food" }, DAY2),
    ];
    const candidates = buildCandidates(events, ALL2);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.name).toBe("비타민D");
    expect(candidates[0]!.kind).toBe("product");
    expect(candidates[0]!.category).toBe("food");
    expect(candidates[0]!.distinctDays).toBe(2);
    // rawEntryIds 는 원문 단위로 distinct — e1, e2 두 개
    expect(candidates[0]!.rawEntryIds.sort()).toEqual(["e1", "e2"]);
  });

  it("같은 날 두 원문에서 나왔어도 rawEntryIds 는 원문별로 각각 포함된다", () => {
    // e1, e2 는 같은 날이지만 서로 다른 raw_entry_id → rawEntryIds 에는 둘 다 있어야 한다.
    // distinctDays=1 이므로 minDays=2 에서는 제외되지만, minDays=1 이면 포함.
    const events = [
      makeEvent("e1", "food", { name: "오메가3", kind: "food" }, DAY1),
      makeEvent("e2", "food", { name: "오메가3", kind: "food" }, DAY1),
    ];
    const candidates = buildCandidates(events, ALL1);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.rawEntryIds.sort()).toEqual(["e1", "e2"]);
    expect(candidates[0]!.distinctDays).toBe(1);
  });

  it("food skipped_meal 은 name 이 null — 제외", () => {
    const events = [
      makeEvent("e1", "food", { name: null, kind: "skipped_meal" }, DAY1),
      makeEvent("e2", "food", { name: null, kind: "skipped_meal" }, DAY2),
    ];
    expect(buildCandidates(events, ALL2)).toHaveLength(0);
  });

  it("food 는 product, activity 는 regimen, body_care 는 regimen", () => {
    const events = [
      makeEvent("e1", "food", { name: "콜라겐", kind: "food" }, DAY1),
      makeEvent("e2", "food", { name: "콜라겐", kind: "food" }, DAY2),
      makeEvent("e3", "activity", { name: "산책" }, DAY1),
      makeEvent("e4", "activity", { name: "산책" }, DAY2),
      makeEvent("e5", "body_care", { action_text: "두피 마사지" }, DAY1),
      makeEvent("e6", "body_care", { action_text: "두피 마사지" }, DAY2),
    ];
    const candidates = buildCandidates(events, ALL2);
    const byName = Object.fromEntries(candidates.map((c) => [c.name, c.kind]));
    expect(byName["콜라겐"]).toBe("product");
    expect(byName["산책"]).toBe("regimen");
    expect(byName["두피 마사지"]).toBe("regimen");
  });

  it("medication 은 product", () => {
    const events = [
      makeEvent("e1", "medication", { name: "레보티록신", kind: "taken" }, DAY1),
      makeEvent("e2", "medication", { name: "레보티록신", kind: "taken" }, DAY2),
    ];
    const candidates = buildCandidates(events, ALL2);
    expect(candidates[0]!.kind).toBe("product");
  });

  it("정규화 일치 이름은 같은 그룹으로 묶인다 (비타민 D ↔ 비타민D)", () => {
    const events = [
      makeEvent("e1", "food", { name: "비타민 D", kind: "food" }, DAY1),
      makeEvent("e2", "food", { name: "비타민D", kind: "food" }, DAY2),
    ];
    const candidates = buildCandidates(events, ALL2);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.distinctDays).toBe(2);
  });

  it("카테고리별 임계값: food 5일 기준에서 4일은 제외, medication 2일 기준에서 2일은 포함", () => {
    const days = ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04"].map(
      (d) => `${d}T00:00:00+09:00`,
    );
    const foodEvents = days.map((d, i) =>
      makeEvent(`f${i}`, "food", { name: "비타민C", kind: "food" }, d),
    );
    const medEvents = [
      makeEvent("m1", "medication", { name: "레보티록신" }, days[0]!),
      makeEvent("m2", "medication", { name: "레보티록신" }, days[1]!),
    ];
    // food=5, medication=2
    const candidates = buildCandidates([...foodEvents, ...medEvents], { food: 5, medication: 2 });
    // 비타민C: 4일 < 5 → 제외. 레보티록신: 2일 >= 2 → 포함.
    expect(candidates.find((c) => c.name === "비타민C")).toBeUndefined();
    expect(candidates.find((c) => c.name === "레보티록신")).toBeDefined();
  });
});

// ── syncThingsFromEvents 통합 (mock Supabase) ─────────────────────────────────

describe("syncThingsFromEvents — blocklist 차단", () => {
  it("blocklist 에 등록된 항목은 건너뛴다", async () => {
    const supabase = makeMockFull({
      events: [
        { raw_entry_id: "e1", category: "food", payload: { name: "유산균", kind: "food" }, raw_entries: { recorded_at: DAY1 } },
        { raw_entry_id: "e2", category: "food", payload: { name: "유산균", kind: "food" }, raw_entries: { recorded_at: DAY2 } },
      ],
      existingThings: [],
      blocklist: [{ kind: "product", normalized_name: "유산균" }],
    });

    // food 기본 임계값 5일 이상이라 2일로 overrride
    const result = await syncThingsFromEvents(supabase, "user-1", { minDaysByCategory: { food: 2 } });
    expect(result.blocked).toBe(1);
    expect(result.created).toBe(0);
    // thing_mentions 에 upsert 하지 않았어야 한다
    expect(supabase._upsertCalls.filter((c) => c.table === "thing_mentions")).toHaveLength(0);
  });
});

describe("syncThingsFromEvents — aliases 로 기존 thing 에 붙기", () => {
  it("정규화 일치 → 기존 thing 에 mention 추가 (merged)", async () => {
    const supabase = makeMockFull({
      events: [
        { raw_entry_id: "e1", category: "food", payload: { name: "비타민D", kind: "food" }, raw_entries: { recorded_at: DAY1 } },
        { raw_entry_id: "e2", category: "food", payload: { name: "비타민D", kind: "food" }, raw_entries: { recorded_at: DAY2 } },
      ],
      existingThings: [
        { id: "thing-1", kind: "product", name: "비타민 D3", aliases: ["비타민D", "비타민d"] },
      ],
      blocklist: [],
    });

    const result = await syncThingsFromEvents(supabase, "user-1", { minDaysByCategory: { food: 2 } });
    expect(result.merged).toBe(1);
    expect(result.created).toBe(0);
    // things INSERT 가 없어야 한다
    expect(supabase._insertCalls.filter((c) => c.table === "things")).toHaveLength(0);
    // thing_mentions upsert 가 있어야 한다
    const mentionUpserts = supabase._upsertCalls.filter((c) => c.table === "thing_mentions");
    expect(mentionUpserts.length).toBeGreaterThan(0);
  });
});

describe("syncThingsFromEvents — 멱등성(두 번 실행)", () => {
  it("두 번 실행해도 thing 생성·mention upsert 횟수가 동일하다 (ignoreDuplicates 가 중복을 막는다)", async () => {
    const events = [
      { raw_entry_id: "e1", category: "food" as const, payload: { name: "오메가3", kind: "food" }, raw_entries: { recorded_at: DAY1 } },
      { raw_entry_id: "e2", category: "food" as const, payload: { name: "오메가3", kind: "food" }, raw_entries: { recorded_at: DAY2 } },
    ];
    const opts = { minDaysByCategory: { food: 2 } as const };

    // 첫 번째 실행: things 에 아무것도 없음
    const supabase1 = makeMockFull({ events, existingThings: [], blocklist: [], newThingId: "tid-1" });
    const r1 = await syncThingsFromEvents(supabase1, "user-1", opts);
    expect(r1.created).toBe(1);
    const upserts1 = supabase1._upsertCalls.filter((c) => c.table === "thing_mentions").length;

    // 두 번째 실행: 이제 things 에 방금 만든 thing 이 있음.
    // mention_count 는 DB 의 upsert ignoreDuplicates 가 보장하므로 여기서는
    // 같은 수의 upsert 호출이 발생하는지만 확인한다.
    const supabase2 = makeMockFull({
      events,
      existingThings: [{ id: "tid-1", kind: "product", name: "오메가3", aliases: [] }],
      blocklist: [],
    });
    const r2 = await syncThingsFromEvents(supabase2, "user-1", opts);
    // 두 번째에는 merged (기존 thing 에 mention 추가), new 는 없음
    expect(r2.created).toBe(0);
    expect(r2.merged).toBe(1);
    const upserts2 = supabase2._upsertCalls.filter((c) => c.table === "thing_mentions").length;
    // 두 번 모두 동일한 횟수의 upsert 호출 (실제 중복 방지는 DB onConflict 가 담당)
    expect(upserts1).toBe(upserts2);
  });
});

describe("syncThingsFromEvents — dry-run", () => {
  it("dry-run 은 DB 에 쓰지 않고 예상 결과만 반환한다", async () => {
    const supabase = makeMockFull({
      events: [
        { raw_entry_id: "e1", category: "activity" as const, payload: { name: "줄넘기" }, raw_entries: { recorded_at: DAY1 } },
        { raw_entry_id: "e2", category: "activity" as const, payload: { name: "줄넘기" }, raw_entries: { recorded_at: DAY2 } },
      ],
      existingThings: [],
      blocklist: [],
    });

    // activity 기본 임계값은 2일 — 추가 override 없이도 통과
    const result = await syncThingsFromEvents(supabase, "user-1", { dryRun: true });
    expect(result.created).toBe(1);
    expect(result.candidates[0]!.status).toBe("new");
    expect(result.candidates[0]!.category).toBe("activity");
    // 실제 쓰기 없음
    expect(supabase._insertCalls.filter((c) => c.table === "things")).toHaveLength(0);
    expect(supabase._upsertCalls.filter((c) => c.table === "thing_mentions")).toHaveLength(0);
  });
});

describe("syncThingsFromEvents — thresholds 반환", () => {
  it("minDays override 시 모든 카테고리 임계값이 동일하게 반환된다", async () => {
    const supabase = makeMockFull({ events: [], existingThings: [], blocklist: [] });
    const result = await syncThingsFromEvents(supabase, "user-1", { minDays: 3 });
    expect(result.thresholds).toEqual({ food: 3, medication: 3, activity: 3, body_care: 3 });
  });

  it("카테고리별 override 시 해당 카테고리만 반영된다", async () => {
    const supabase = makeMockFull({ events: [], existingThings: [], blocklist: [] });
    const result = await syncThingsFromEvents(supabase, "user-1", {
      minDaysByCategory: { food: 7 },
    });
    expect(result.thresholds.food).toBe(7);
    expect(result.thresholds.medication).toBe(2); // DEFAULT_MIN_DAYS
    expect(result.thresholds.activity).toBe(2);
  });
});
