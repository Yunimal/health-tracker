import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";
import { parseJsonLenient } from "@/lib/parser";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Thing } from "@/lib/db/schema";

/**
 * 지속 대상(thing) 추출·병합·저장. (기능 [2])
 *
 * 파싱 파이프라인과 완전히 분리된 별도 단계다:
 *  - 파싱 프롬프트에 포함하지 않는다 (비용·복잡도 격리).
 *  - 실패해도 파싱 결과(events/hypotheses)는 보존된다.
 *  - persistThings 를 직접 호출하면 대상 추출만 따로 재실행할 수 있다.
 *
 * 병합 전략: LLM 을 쓰지 않고 결정적 규칙만 사용한다.
 *  - 정규화 이름 완전 일치 또는 aliases 포함 → 자동 병합(merge).
 *  - same kind + 편집거리 ≤ 2 → 후보로만 표시, 자동 병합 금지(candidate → 새 thing 생성).
 *  - 그 외 → 새 thing 생성.
 *  잘못 합치면 복구 불가, 중복은 나중에 합칠 수 있다.
 */

export type ThingKind = "treatment" | "product" | "place" | "regimen";

export interface ExtractedThing {
  kind: ThingKind;
  name: string;
  excerpt: string | null;
}

/** matchThing 반환 타입. candidate 는 자동 병합하지 않고 새 thing 을 만든다. */
export type MatchResult =
  | { type: "merge"; thingId: string }
  | { type: "candidate"; thingId: string } // 유사하나 자동 병합 금지
  | { type: "new" };

const MAX_TOKENS = 1024;

const SYSTEM = `너는 건강 기록 원문에서 "지속 대상(thing)"을 추출한다.
지속 대상이란 여러 날에 걸쳐 추적할 가치가 있는 특정 고유 대상이다.

## 역할 범위

이벤트 집계 경로가 음식·약·영양제·운동 이름을 구조화된 이벤트 필드에서 이미 뽑아 등록한다.
**이 경로는 그쪽이 담지 못하는 것만 담당한다.**

### 뽑는 것

- **treatment** — 전문가에게 받는 시술·치료·처치·검사
  (예: 쥬베룩, 보톡스, 도수치료, 레이저 토닝, 인바디, 혈액검사)
  아래 신호 표현이 있으면 시술·처치 이름이 있는지 **적극** 확인한다:
  "받고 옴" / "맞으러 감" / "시술" / "주사" / "회차" / "다녀옴" / "레이저" / "관리 받음"

- **place** — 특정 장소. **방문 서술이 있을 때만** 뽑는다.
  허용: "~에 갔다/왔다", "~에서 받았다", "~다녀왔다"
  금지: 단순 맥락 언급 — "강남 쪽에서" / "그 병원 근처" / "~에서 봤다"

- **regimen** — 이벤트 필드에 이름이 없는 식이요법·루틴 (간헐적 단식, 저탄고지 식이)

- **product** — 이벤트에 안 잡히는 화장품·기기·미용 제품 (리들샷, 자음생 에센스, 갈바닉기기)

### 뽑지 않는 것 (금지)

- 음식·식재료·음료 — 이벤트 집계 경로 담당
- 약·영양제 이름 — 이벤트 집계 경로 담당
- 운동 이름 — 이벤트 집계 경로 담당
- 일반 명사 ("병원", "의사", "약", "크림", "주사") — 특정 대상이 아님
- **감탄사·의성어·감정 표현** ("샤갈", "대박", "와우", "헐") — 사람·장소·사물이 아님
- 방문 서술 없이 단순 언급된 장소
- 어느 kind 인지 확신 없는 것 — **애매하면 건너뛴다** (잘못 뽑힌 건 사용자가 직접 지워야 해서 비용이 크다)

## 출력

아래 JSON **하나만**. 코드펜스도 다른 텍스트도 붙이지 않는다.
{ "things": [{ "kind": "treatment|product|place|regimen", "name": "...", "excerpt": "..." }] }

- things 없으면 \`{ "things": [] }\`
- name: 가장 대표적인 짧은 이름 (브랜드명·고유명 그대로)
- excerpt: 원문에서 이 대상이 등장하는 가장 짧은 구절을 원문 그대로

## 예시

입력: "오늘 필러 3cc 이마랑 팔자에 맞고 왔어. 얼굴이 좀 빵빵한 느낌."
출력: { "things": [{ "kind": "treatment", "name": "필러", "excerpt": "필러 3cc 이마랑 팔자에 맞고 왔어" }] }

입력: "물광주사 2회차 다녀옴. 스킨부스터라 다음날 피부가 달라진다고 했는데."
출력: { "things": [{ "kind": "treatment", "name": "물광주사", "excerpt": "물광주사 2회차 다녀옴" }] }

입력: "단골 피부과 갔다왔어. 원장쌤이 다음엔 리프팅 받아보라고 했어."
출력: { "things": [{ "kind": "place", "name": "단골 피부과", "excerpt": "단골 피부과 갔다왔어" }] }

입력: "오늘 날씨가 진짜 샤갈이야. 기분도 별로고 점심엔 파스타 먹었어."
출력: { "things": [] }

입력: "아침에 유산균이랑 오메가3 챙겨 먹었고 저녁엔 스트레칭 했어."
출력: { "things": [] }`;

/** 원문에서 지속 대상을 LLM 으로 추출한다. 실패 시 던진다(호출부가 처리). */
export async function extractThings(transcript: string): Promise<ExtractedThing[]> {
  const client = new Anthropic({ apiKey: env.anthropicApiKey() });
  const msg = await client.messages.create({
    model: env.parseModel(),
    max_tokens: MAX_TOKENS,
    thinking: { type: "disabled" }, // 규칙이 프롬프트에 있어 사고 불필요. (CLAUDE.md)
    system: SYSTEM,
    messages: [{ role: "user", content: transcript }],
  });
  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const parsed = parseJsonLenient(text);
  if (!parsed.ok) return [];

  const root = parsed.value as { things?: unknown };
  if (!Array.isArray(root.things)) return [];

  const VALID_KINDS = new Set<string>(["treatment", "product", "place", "regimen"]);
  const result: ExtractedThing[] = [];
  for (const t of root.things) {
    if (!t || typeof t !== "object") continue;
    const { kind, name, excerpt } = t as Record<string, unknown>;
    if (typeof kind !== "string" || !VALID_KINDS.has(kind)) continue;
    if (typeof name !== "string" || !name.trim()) continue;
    result.push({
      kind: kind as ThingKind,
      name: name.trim(),
      excerpt: typeof excerpt === "string" ? excerpt.trim() || null : null,
    });
  }
  return result;
}

// ── 결정적 병합 로직 ─────────────────────────────────────────────────────────

/** 이름을 소문자·공백·구분자 제거해 비교용 키로 만든다. */
export function normalize(s: string): string {
  return s.toLowerCase().replace(/[\s\-_·.·,。]/g, "");
}

/** 편집 거리(Levenshtein). 짧은 이름 비교용이므로 기본 DP 로 충분하다. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr.push(Math.min(curr[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost));
    }
    prev.splice(0, prev.length, ...curr);
  }
  return prev[b.length]!;
}

interface ExistingThing {
  id: string;
  kind: string;
  name: string;
  aliases: string[];
}

/**
 * incoming thing 이 기존 things 중 어느 것과 대응하는지 결정적 규칙으로 판정한다.
 *
 * merge  — 자동 병합. 정규화 이름 완전 일치 또는 aliases 포함.
 * candidate — 자동 병합 금지. same kind + 아래 중 하나:
 *   (a) 편집거리 ≤ 2 (오타·발음 차이)
 *   (b) 포함 관계 — 짧은 쪽(2자 이상)이 긴 쪽에 통째로 포함됨 ("유산균" ⊂ "공복유산균")
 *   잘못 합치면 복구 불가, 중복은 나중에 합칠 수 있다.
 * new    — 새 thing 생성.
 */
export function matchThing(
  incoming: { kind: ThingKind; normalizedName: string },
  existing: ExistingThing[],
): MatchResult {
  for (const t of existing) {
    const allNorms = [normalize(t.name), ...t.aliases.map(normalize)];
    if (allNorms.includes(incoming.normalizedName)) {
      return { type: "merge", thingId: t.id };
    }
  }
  for (const t of existing) {
    if (t.kind !== incoming.kind) continue;
    const existingNorm = normalize(t.name);
    if (levenshtein(incoming.normalizedName, existingNorm) <= 2) {
      return { type: "candidate", thingId: t.id };
    }
    // 포함 관계: 짧은 쪽이 2자 이상이고 긴 쪽에 통째로 포함되면 후보.
    const shorter = incoming.normalizedName.length <= existingNorm.length ? incoming.normalizedName : existingNorm;
    const longer  = incoming.normalizedName.length <= existingNorm.length ? existingNorm : incoming.normalizedName;
    if (shorter.length >= 2 && longer.includes(shorter)) {
      return { type: "candidate", thingId: t.id };
    }
  }
  return { type: "new" };
}

/**
 * mention 이 0이 된 thing 을 삭제해도 되는지 판단한다.
 *
 * note 가 없으면 삭제한다(파생 데이터).
 * note 가 있으면 남긴다 — 사용자가 직접 쓴 메모는 파생 데이터가 아니다.
 * 재파싱이 사용자의 직접 작성 내용을 지워서는 안 된다.
 */
export function shouldDeleteOrphanedThing(note: string | null | undefined): boolean {
  return !note || note.trim() === "";
}

// ── 병합 후보 탐색 ───────────────────────────────────────────────────────────

export type CandidatePair = { a: Thing; b: Thing };

/**
 * 전체 thing 목록에서 "합칠 만한 쌍"을 찾는다.
 *
 * 후보 조건 (same kind 이고 아래 중 하나):
 *  (a) 편집거리 ≤ 2 (오타·발음 차이)
 *  (b) 포함 관계 — 짧은 쪽(2자 이상)이 긴 쪽에 통째로 포함됨 ("유산균" ⊂ "공복유산균")
 *
 * 제외 조건:
 *  - 이미 정규화 이름 완전 일치(aliases 포함) → 실제로는 같은 대상이라 이미 병합됐어야 함
 *  - rejectedPairs 에 있는 쌍 → 사용자가 "다름"으로 거부한 것
 *
 * rejectedPairs 키 형식: "minId:maxId" (uuid 문자열 비교 기준 정렬)
 */
export function findMergeCandidates(
  things: Thing[],
  rejectedPairs: Set<string> = new Set(),
): CandidatePair[] {
  const pairs: CandidatePair[] = [];
  for (let i = 0; i < things.length; i++) {
    for (let j = i + 1; j < things.length; j++) {
      const a = things[i]!;
      const b = things[j]!;
      if (a.kind !== b.kind) continue;

      const normA = normalize(a.name);
      const normB = normalize(b.name);
      // 이미 하나가 상대방의 alias 인 경우 — 별도 처리 불필요
      const allNormsA = [normA, ...a.aliases.map(normalize)];
      if (allNormsA.includes(normB)) continue;
      const allNormsB = [normB, ...b.aliases.map(normalize)];
      if (allNormsB.includes(normA)) continue;

      // (a) 편집거리 ≤ 2
      const isSimilar = levenshtein(normA, normB) <= 2;

      // (b) 포함 관계: 짧은 쪽이 2자 이상이고 긴 쪽에 통째로 포함됨
      const shorter = normA.length <= normB.length ? normA : normB;
      const longer  = normA.length <= normB.length ? normB : normA;
      const isContained = shorter.length >= 2 && longer.includes(shorter);

      if (!isSimilar && !isContained) continue;

      // 거부된 쌍 제외 (canonical order)
      const [minId, maxId] = [a.id, b.id].sort();
      if (rejectedPairs.has(`${minId}:${maxId}`)) continue;

      pairs.push({ a, b });
    }
  }
  return pairs;
}

// ── DB 저장 ──────────────────────────────────────────────────────────────────

/** mention_count / first_seen_at / last_seen_at 를 재계산하고, 0이 된 파생 thing 을 삭제한다. */
export async function recountThing(supabase: SupabaseClient, thingId: string): Promise<void> {
  const { data, error } = await supabase
    .from("thing_mentions")
    .select("created_at")
    .eq("thing_id", thingId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { created_at: string }[];

  if (rows.length === 0) {
    const { data: thing } = await supabase
      .from("things")
      .select("note")
      .eq("id", thingId)
      .single();
    if (shouldDeleteOrphanedThing((thing as { note?: string | null } | null)?.note)) {
      const del = await supabase.from("things").delete().eq("id", thingId);
      if (del.error) throw new Error(del.error.message);
    }
    return;
  }

  const upd = await supabase
    .from("things")
    .update({
      mention_count: rows.length,
      first_seen_at: rows[0]!.created_at,
      last_seen_at: rows[rows.length - 1]!.created_at,
    })
    .eq("id", thingId);
  if (upd.error) throw new Error(upd.error.message);
}

/**
 * 지속 대상 추출·병합·저장. reparseEntry 에서 파싱 성공 후 별도로 호출된다.
 *
 * 1) 이 원문의 기존 mentions 제거 + 영향받는 thing 재계산(멱등 재파싱).
 * 2) LLM 으로 transcript 에서 things 추출.
 * 3) 기존 things 와 결정적 규칙으로 매칭 → merge/새 생성.
 * 4) mention 삽입(upsert — unique 제약으로 중복 방지) + 재계산.
 *
 * ⚠️ 트랜잭션 없음. 중간 실패 시 재파싱으로 복구한다. (persistHypotheses 와 같은 방침)
 */
export async function persistThings(
  supabase: SupabaseClient,
  userId: string,
  entryId: string,
  transcript: string,
): Promise<number> {
  // 1) 기존 mentions 제거 + 재계산.
  const { data: myMentions, error: mErr } = await supabase
    .from("thing_mentions")
    .select("id, thing_id")
    .eq("raw_entry_id", entryId);
  if (mErr) throw new Error(mErr.message);

  const affected = new Set<string>();
  const mentionIds: string[] = [];
  for (const row of (myMentions ?? []) as { id: string; thing_id: string }[]) {
    mentionIds.push(row.id);
    affected.add(row.thing_id);
  }
  if (mentionIds.length > 0) {
    const del = await supabase.from("thing_mentions").delete().in("id", mentionIds);
    if (del.error) throw new Error(del.error.message);
  }
  for (const thingId of affected) await recountThing(supabase, thingId);

  // 2) LLM 추출.
  const extracted = await extractThings(transcript);
  if (extracted.length === 0) return 0;

  // 3) 기존 things + blocklist 로드(한 번만).
  const [existingRes, blocklistRes] = await Promise.all([
    supabase.from("things").select("id, kind, name, aliases").eq("user_id", userId),
    supabase.from("thing_blocklist").select("kind, normalized_name").eq("user_id", userId),
  ]);
  if (existingRes.error) throw new Error(existingRes.error.message);
  if (blocklistRes.error) throw new Error(blocklistRes.error.message);
  const existingThings: ExistingThing[] = (existingRes.data ?? []) as ExistingThing[];
  // blocklist 키 형식: "kind:normalizedName" — O(1) 조회
  const blocklist = new Set(
    (blocklistRes.data ?? []).map((r) => `${r.kind}:${r.normalized_name}`),
  );

  // 4) 매칭 → mention 삽입.
  let count = 0;
  for (const ex of extracted) {
    const normName = normalize(ex.name);
    // blocklist 에 등록된 대상은 건너뛴다.
    // ⚠️ 파생 데이터가 아님 — 사용자가 직접 삭제한 것이므로 재파싱으로 되돌아가지 않는다.
    if (blocklist.has(`${ex.kind}:${normName}`)) {
      console.info(`[persistThings] blocklist 등록 항목 건너뜀: "${ex.name}" (${ex.kind})`);
      continue;
    }
    const match = matchThing({ kind: ex.kind, normalizedName: normName }, existingThings);

    let thingId: string;
    if (match.type === "merge") {
      thingId = match.thingId;
      // 다르게 표현된 이름을 aliases 에 추가한다(표현 다양성 보존).
      const canonical = existingThings.find((t) => t.id === thingId)!;
      if (ex.name !== canonical.name && !canonical.aliases.includes(ex.name)) {
        const newAliases = [...canonical.aliases, ex.name];
        await supabase.from("things").update({ aliases: newAliases }).eq("id", thingId);
        canonical.aliases = newAliases;
      }
    } else {
      if (match.type === "candidate") {
        // 유사하지만 병합하지 않는다 — 잘못 합치면 복구 불가, 중복은 나중에 합칠 수 있다.
        console.info(`[persistThings] 병합 후보(자동 병합 안 함): "${ex.name}" ↔ thing ${match.thingId}`);
      }
      const { data: newThing, error: insErr } = await supabase
        .from("things")
        .insert({ user_id: userId, kind: ex.kind, name: ex.name })
        .select("id")
        .single();
      if (insErr) throw new Error(insErr.message);
      thingId = (newThing as { id: string }).id;
      existingThings.push({ id: thingId, kind: ex.kind, name: ex.name, aliases: [] });
    }

    const upsert = await supabase.from("thing_mentions").upsert(
      { thing_id: thingId, raw_entry_id: entryId, user_id: userId, excerpt: ex.excerpt },
      { onConflict: "thing_id,raw_entry_id" },
    );
    if (upsert.error) throw new Error(upsert.error.message);
    await recountThing(supabase, thingId);
    count++;
  }
  return count;
}
