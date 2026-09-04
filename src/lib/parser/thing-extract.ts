import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";
import { parseJsonLenient } from "@/lib/parser";
import type { SupabaseClient } from "@supabase/supabase-js";

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

kind 분류:
- treatment: 전문가에게 받는 시술·치료·검사 (쥬베룩, 도수치료, 인바디 검사)
- product: 특정 제품·영양제·약품 (비타민D, 리들샷, 설화수 자음생 에센스)
- place: 특정 장소 (강남차병원, 내 헬스장, 단골 카페)
- regimen: 지속적인 루틴·식이요법·습관 (저탄고지, 간헐적 단식, 아침 스트레칭 루틴)

뽑지 않는 것 (금지):
- 일반 명사 ("의사", "병원", "약", "운동", "크림") — 특정 대상이 아니다
- 음식·식재료 — food 카테고리가 처리한다
- 일회성 언급으로 여러 날에 걸쳐 추적할 이유가 없는 것
- 어느 kind 인지 확신 없으면 건너뛴다

출력: 아래 JSON 하나만. 코드펜스도 다른 텍스트도 붙이지 않는다.
{ "things": [{ "kind": "treatment|product|place|regimen", "name": "...", "excerpt": "..." }] }

- things 가 없으면 { "things": [] } 를 반환한다
- name: 가장 대표적인 짧은 이름 (고유명·브랜드명 그대로)
- excerpt: 원문에서 이 대상이 등장하는 가장 짧은 구절을 원문 그대로

보수적으로 뽑는다. 애매하면 건너뛴다.`;

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
 * candidate — 자동 병합 금지. same kind + 편집거리 ≤ 2(오타·발음 차이).
 *            잘못 합치면 복구 불가, 중복은 나중에 합칠 수 있다.
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
    if (levenshtein(incoming.normalizedName, normalize(t.name)) <= 2) {
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

// ── DB 저장 ──────────────────────────────────────────────────────────────────

/** mention_count / first_seen_at / last_seen_at 를 재계산하고, 0이 된 파생 thing 을 삭제한다. */
async function recountThing(supabase: SupabaseClient, thingId: string): Promise<void> {
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

  // 3) 기존 things 로드(한 번만).
  const { data: existingData, error: exErr } = await supabase
    .from("things")
    .select("id, kind, name, aliases")
    .eq("user_id", userId);
  if (exErr) throw new Error(exErr.message);
  const existingThings: ExistingThing[] = (existingData ?? []) as ExistingThing[];

  // 4) 매칭 → mention 삽입.
  let count = 0;
  for (const ex of extracted) {
    const normName = normalize(ex.name);
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
