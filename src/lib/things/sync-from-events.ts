/**
 * 이벤트 집계 기반 things 동기화.
 *
 * LLM 추출(persistThings) 과 독립된 두 번째 경로:
 *  - 이미 구조화된 이벤트 payload 에서 이름을 읽는다 — LLM 호출 없음, 결정적, 무료.
 *  - food.name / medication.name → kind: product
 *    activity.name / body_care.action_text → kind: regimen
 *  - 카테고리별 임계값(DEFAULT_MIN_DAYS) 이상 서로 다른 날 등장한 이름만 등록.
 *  - 기존 things 와 정규화 일치·aliases 에 있으면 mention 만 추가(중복 생성 없음).
 *  - thing_blocklist 에 있으면 건너뛴다.
 *  - 재실행해도 중복이 생기지 않는다: thing_mentions unique(thing_id, raw_entry_id).
 *
 * 주의: mention.raw_entry_id 는 이벤트의 raw_entry_id 를 그대로 쓴다.
 * 한 raw_entry 에서 같은 이름이 여러 이벤트로 나와도 mention 은 1건만 저장된다.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalize, matchThing, recountThing } from "@/lib/parser/thing-extract";
import type { ThingKind } from "@/lib/parser/thing-extract";

// ── 카테고리별 기본 임계값 ────────────────────────────────────────────────────

export type EventCategory = "food" | "medication" | "activity" | "body_care";

/**
 * 카테고리별 기본 "서로 다른 날" 임계값.
 *
 * food: 5일 — 그날 먹은 메뉴 대신 습관적으로 먹는 것(영양제·루틴 식품)만 포착.
 *   일반 식사 메뉴는 며칠에 한 번 나와도 추적 대상이 아니라 기준을 높인다.
 *
 * medication: 2일 — 가끔 먹어도 효과·부작용 관찰이 필요해 기준을 낮게 유지한다.
 *
 * activity: 2일 — 반복하는 운동만. 단발성 체험(마라톤 대회 등)은 제외.
 *
 * body_care: 2일 — 루틴화한 관리만. 일회성 기록은 제외.
 */
export const DEFAULT_MIN_DAYS: Record<EventCategory, number> = {
  food: 5,
  medication: 2,
  activity: 2,
  body_care: 2,
};

// ── 내부 타입 ─────────────────────────────────────────────────────────────────

interface EventRow {
  raw_entry_id: string;
  category: string;
  payload: Record<string, unknown>;
  recorded_at: string; // raw_entries.recorded_at (UTC ISO)
}

interface RawEventRow {
  raw_entry_id: string;
  category: string;
  payload: unknown;
  raw_entries: { recorded_at: string } | { recorded_at: string }[] | null;
}

interface ExistingThing {
  id: string;
  kind: string;
  name: string;
  aliases: string[];
}

// ── 공개 타입 ─────────────────────────────────────────────────────────────────

/** 임계값을 넘은 이름 후보. */
export interface SyncCandidate {
  name: string;
  normName: string;
  kind: ThingKind;
  category: EventCategory; // 출처 카테고리 (dry-run 그룹 출력·임계값 표시에 사용)
  distinctDays: number;
  rawEntryIds: string[]; // distinct raw_entry_ids → 이 수만큼 mention 생성
}

export type SyncStatus = "new" | "merged" | "blocked";

export interface SyncAnnotated extends SyncCandidate {
  status: SyncStatus;
}

export interface SyncResult {
  candidates: SyncAnnotated[];
  created: number;       // 새로 생성된 thing 수
  merged: number;        // 기존 thing 에 mention 추가(새 생성 없음)
  blocked: number;       // blocklist 에 막힌 후보 수
  mentionsAdded: number; // 실제 삽입(또는 dry-run 시 예상) mention 수
  thresholds: Record<EventCategory, number>; // 실제 사용된 카테고리별 임계값
}

// ── 유틸 ─────────────────────────────────────────────────────────────────────

/** UTC ISO → KST YYYY-MM-DD (queries.ts 와 동일 규칙). */
function kstDay(utcIso: string): string {
  return new Date(new Date(utcIso).getTime() + 9 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

/** 이벤트 1건에서 (name, kind) 를 추출한다. 해당 없으면 null. */
function extractNameAndKind(row: EventRow): { name: string; kind: ThingKind } | null {
  const p = row.payload;
  switch (row.category) {
    case "food": {
      if (p["kind"] === "skipped_meal") return null;
      const name = p["name"];
      if (typeof name !== "string" || !name.trim()) return null;
      return { name: name.trim(), kind: "product" };
    }
    case "medication": {
      const name = p["name"];
      if (typeof name !== "string" || !name.trim()) return null;
      return { name: name.trim(), kind: "product" };
    }
    case "activity": {
      const name = p["name"];
      if (typeof name !== "string" || !name.trim()) return null;
      return { name: name.trim(), kind: "regimen" };
    }
    case "body_care": {
      const text = p["action_text"];
      if (typeof text !== "string" || !text.trim()) return null;
      return { name: text.trim(), kind: "regimen" };
    }
    default:
      return null;
  }
}

// ── 핵심 로직 ─────────────────────────────────────────────────────────────────

/**
 * 카테고리별 임계값을 적용해 후보를 계산한다. 순수 함수 — DB 호출 없음.
 *
 * 그룹 키: (category, normalize(name))
 *  - category 를 키에 포함한 이유: food 와 medication 이 같은 이름을 가져도
 *    별도 후보로 처리해 카테고리별 임계값을 독립적으로 적용한다.
 *    DB 에서는 같은 kind:normName 이면 matchThing 이 하나로 합쳐 중복 생성을 막는다.
 *
 * minDaysByCategory: 카테고리별 임계값. 없는 카테고리는 DEFAULT_MIN_DAYS, 그것도 없으면 2.
 * 같은 raw_entry_id 가 여러 이벤트에서 나와도 rawEntryIds 는 중복 없이 저장된다.
 */
export function buildCandidates(
  events: EventRow[],
  minDaysByCategory: Partial<Record<EventCategory, number>>,
): SyncCandidate[] {
  type Group = {
    name: string;
    kind: ThingKind;
    category: EventCategory;
    normName: string;
    days: Set<string>;
    entryIds: Set<string>;
  };
  const groups = new Map<string, Group>();

  for (const event of events) {
    const extracted = extractNameAndKind(event);
    if (!extracted) continue;
    const normName = normalize(extracted.name);
    if (!normName) continue;
    // 카테고리를 키에 포함 → 카테고리별 임계값 독립 적용
    const key = `${event.category}:${normName}`;
    const day = kstDay(event.recorded_at);

    const g = groups.get(key);
    if (g) {
      g.days.add(day);
      g.entryIds.add(event.raw_entry_id);
    } else {
      groups.set(key, {
        name: extracted.name,
        kind: extracted.kind,
        category: event.category as EventCategory,
        normName,
        days: new Set([day]),
        entryIds: new Set([event.raw_entry_id]),
      });
    }
  }

  const result: SyncCandidate[] = [];
  for (const g of groups.values()) {
    const threshold =
      minDaysByCategory[g.category] ?? DEFAULT_MIN_DAYS[g.category] ?? 2;
    if (g.days.size < threshold) continue;
    result.push({
      name: g.name,
      normName: g.normName,
      kind: g.kind,
      category: g.category,
      distinctDays: g.days.size,
      rawEntryIds: [...g.entryIds],
    });
  }
  // 등장 일수 내림차순, 같으면 이름 오름차순 (dry-run 출력 가독성)
  return result.sort((a, b) => b.distinctDays - a.distinctDays || a.name.localeCompare(b.name));
}

/**
 * 카테고리별 임계값을 실제 사용할 값으로 확정한다.
 * minDays 가 있으면 전체 override (실험용). 없으면 DEFAULT_MIN_DAYS + 카테고리별 override 병합.
 */
export function resolveThresholds(opts: {
  minDays?: number | null;
  minDaysByCategory?: Partial<Record<EventCategory, number>>;
}): Record<EventCategory, number> {
  if (opts.minDays != null) {
    return { food: opts.minDays, medication: opts.minDays, activity: opts.minDays, body_care: opts.minDays };
  }
  return { ...DEFAULT_MIN_DAYS, ...opts.minDaysByCategory };
}

/**
 * 이벤트 집계 기반 things 동기화.
 *
 * opts.minDays            전체 override (기본값 무시, 실험용).
 * opts.minDaysByCategory  카테고리별 override (DEFAULT_MIN_DAYS 위에 덮어씀).
 *                         minDays 가 있으면 이 값은 무시된다.
 * opts.dryRun             true 면 DB 쓰기 없이 예상 결과만 반환한다.
 *
 * 멱등: thing_mentions unique(thing_id, raw_entry_id) 가 중복을 막는다.
 * 재실행해도 mention_count 가 늘지 않는다.
 */
export async function syncThingsFromEvents(
  supabase: SupabaseClient,
  userId: string,
  opts: {
    minDays?: number;
    minDaysByCategory?: Partial<Record<EventCategory, number>>;
    dryRun?: boolean;
  } = {},
): Promise<SyncResult> {
  const thresholds = resolveThresholds(opts);
  const dryRun = opts.dryRun ?? false;

  // 이벤트 + 원문의 recorded_at 로드.
  const { data: eventData, error: evErr } = await supabase
    .from("events")
    .select("raw_entry_id, category, payload, raw_entries(recorded_at)")
    .eq("user_id", userId)
    .in("category", ["food", "medication", "activity", "body_care"]);
  if (evErr) throw new Error(evErr.message);

  const events: EventRow[] = ((eventData ?? []) as RawEventRow[]).map((row) => {
    const re = Array.isArray(row.raw_entries) ? row.raw_entries[0] : row.raw_entries;
    return {
      raw_entry_id: row.raw_entry_id,
      category: row.category,
      payload: row.payload as Record<string, unknown>,
      recorded_at: re?.recorded_at ?? new Date(0).toISOString(),
    };
  });

  const candidates = buildCandidates(events, thresholds);
  if (candidates.length === 0) {
    return { candidates: [], created: 0, merged: 0, blocked: 0, mentionsAdded: 0, thresholds };
  }

  // 기존 things + blocklist 로드 (병렬).
  const [existingRes, blocklistRes] = await Promise.all([
    supabase.from("things").select("id, kind, name, aliases").eq("user_id", userId),
    supabase.from("thing_blocklist").select("kind, normalized_name").eq("user_id", userId),
  ]);
  if (existingRes.error) throw new Error(existingRes.error.message);
  if (blocklistRes.error) throw new Error(blocklistRes.error.message);

  const existingThings: ExistingThing[] = (existingRes.data ?? []) as ExistingThing[];
  // "kind:normName" 형식으로 O(1) 조회.
  const blocklist = new Set(
    (blocklistRes.data ?? []).map(
      (r: { kind: string; normalized_name: string }) => `${r.kind}:${r.normalized_name}`,
    ),
  );

  let created = 0;
  let merged = 0;
  let blocked = 0;
  let mentionsAdded = 0;
  const annotated: SyncAnnotated[] = [];

  for (const cand of candidates) {
    // blocklist 체크
    if (blocklist.has(`${cand.kind}:${cand.normName}`)) {
      blocked++;
      annotated.push({ ...cand, status: "blocked" });
      continue;
    }

    const match = matchThing(
      { kind: cand.kind, normalizedName: cand.normName },
      existingThings,
    );

    if (match.type === "merge") {
      merged++;
      annotated.push({ ...cand, status: "merged" });
      mentionsAdded += cand.rawEntryIds.length;

      if (!dryRun) {
        await insertMentions(supabase, userId, match.thingId, cand.rawEntryIds);
        await recountThing(supabase, match.thingId);
      }
    } else {
      // candidate 또는 new — 새 thing 생성. (candidate 도 자동 병합 금지, UI 에서 수동 병합)
      created++;
      annotated.push({ ...cand, status: "new" });
      mentionsAdded += cand.rawEntryIds.length;

      if (!dryRun) {
        const { data: newThing, error: insErr } = await supabase
          .from("things")
          .insert({ user_id: userId, kind: cand.kind, name: cand.name })
          .select("id")
          .single();
        if (insErr) throw new Error(insErr.message);
        const thingId = (newThing as { id: string }).id;
        // 이후 매칭에서 이 thing 을 활용할 수 있도록 in-memory 목록에 추가.
        existingThings.push({ id: thingId, kind: cand.kind, name: cand.name, aliases: [] });

        await insertMentions(supabase, userId, thingId, cand.rawEntryIds);
        await recountThing(supabase, thingId);
      }
    }
  }

  return { candidates: annotated, created, merged, blocked, mentionsAdded, thresholds };
}

/** thing_mentions upsert — unique(thing_id, raw_entry_id) 가 중복을 막는다. */
async function insertMentions(
  supabase: SupabaseClient,
  userId: string,
  thingId: string,
  rawEntryIds: string[],
): Promise<void> {
  if (rawEntryIds.length === 0) return;
  const rows = rawEntryIds.map((rawEntryId) => ({
    thing_id: thingId,
    raw_entry_id: rawEntryId,
    user_id: userId,
    excerpt: null,
  }));
  const { error } = await supabase
    .from("thing_mentions")
    .upsert(rows, { onConflict: "thing_id,raw_entry_id", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
}
