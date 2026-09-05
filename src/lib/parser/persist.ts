import type { SupabaseClient } from "@supabase/supabase-js";
import { parseTranscript, PARSE_VERSION, type ParsedHypothesis } from "@/lib/parser";
import { matchHypotheses } from "@/lib/parser/hypothesis-match";
import { persistThings } from "@/lib/parser/thing-extract";
import type { RawEntry } from "@/lib/db/schema";

/**
 * raw_entry 하나를 파싱하고 파생 데이터를 재생성한다. (기획서 §5.1)
 *  - events, unparsed_fragments 는 파생 데이터: DELETE 후 재삽입.
 *  - hypotheses 는 mention 기반 의미 병합(0008, 기능 [1]): 같은 의심이면 기존 canonical 행에
 *    mention 을 붙여 mention_count 를 올리고, 아니면 새 행을 만든다. 재파싱 시 이 원문의
 *    open mention 만 지웠다 다시 넣어 멱등하게 유지한다. (persistHypotheses 참고)
 *  - raw_entries 는 parse_version / parsed_at / parse_error 만 갱신. (0002/0004 트리거 허용 컬럼)
 *    thing_extract_version 은 persistThings 성공 시 persistThings 내부에서 갱신된다. (0016)
 *
 * 실패는 던지지 않고 parse_error 에 기록하고 outcome 으로 돌려준다.
 * /api/parse(수동·배치)와 /api/entries(백그라운드 자동 트리거)가 공유한다.
 */
export interface EntryOutcome {
  raw_entry_id: string;
  ok: boolean;
  events?: number;
  hypotheses?: number;
  unparsed?: number;
  reflections?: number;
  things?: number;
  error?: string;
}

function kstNowIso(): string {
  const kstMs = new Date().getTime() + 9 * 60 * 60 * 1000;
  return new Date(kstMs).toISOString().replace("Z", "+09:00");
}

export async function reparseEntry(
  supabase: SupabaseClient,
  userId: string,
  entry: RawEntry,
  opts: { cachePrompt?: boolean } = {},
): Promise<EntryOutcome> {
  try {
    // 1. 파싱(LLM).
    const result = await parseTranscript(entry.transcript, entry.recorded_at, {
      cachePrompt: opts.cachePrompt ?? false,
    });

    // 2. 기존 파생 데이터 ID 수집 — 삭제는 새 결과를 삽입한 뒤에 한다.
    //    insert-before-delete: 삽입이 실패해도 기존 데이터가 보존된다.
    const [oldEventsRes, oldUnparsedRes, oldReflectionsRes] = await Promise.all([
      supabase.from("events").select("id").eq("raw_entry_id", entry.id),
      supabase.from("unparsed_fragments").select("id").eq("raw_entry_id", entry.id),
      supabase.from("reflections").select("id").eq("raw_entry_id", entry.id),
    ]);
    if (oldEventsRes.error) throw new Error(oldEventsRes.error.message);
    if (oldUnparsedRes.error) throw new Error(oldUnparsedRes.error.message);
    if (oldReflectionsRes.error) throw new Error(oldReflectionsRes.error.message);
    const oldEventIds = ((oldEventsRes.data ?? []) as { id: string }[]).map((r) => r.id);
    const oldUnparsedIds = ((oldUnparsedRes.data ?? []) as { id: string }[]).map((r) => r.id);
    const oldReflectionIds = ((oldReflectionsRes.data ?? []) as { id: string }[]).map((r) => r.id);

    // 3. 새 이벤트 삽입(기존 삭제 전).
    if (result.events.length > 0) {
      const rows = result.events.map((e) => ({
        raw_entry_id: entry.id,
        user_id: userId,
        category: e.category,
        occurred_at: e.occurred_at,
        occurred_at_precision: e.occurred_at_precision,
        payload: e.payload,
        confidence: e.confidence,
        needs_review: e.needs_review,
      }));
      const ins = await supabase.from("events").insert(rows);
      if (ins.error) throw new Error(ins.error.message);
    }

    // 4. 가설: 의미 병합(mention 기반). 내부도 insert-before-delete 순서를 따른다.
    //    incoming 이 0이어도 이 원문의 옛 mention 정리를 위해 호출.
    await persistHypotheses(supabase, userId, entry.id, result.hypotheses);

    // 5. 새 unparsed / reflections 삽입(기존 삭제 전).
    if (result.unparsed.length > 0) {
      const rows = result.unparsed.map((text) => ({
        raw_entry_id: entry.id,
        user_id: userId,
        text,
      }));
      const ins = await supabase.from("unparsed_fragments").insert(rows);
      if (ins.error) throw new Error(ins.error.message);
    }

    // reflections 는 파생 데이터: 새로 만든 뒤 기존을 지운다. reflection_replies 는 건드리지 않는다
    // (파생 아님 — 사용자가 읽은 응답이 재파싱으로 사라지면 안 된다). (0012)
    if (result.reflections.length > 0) {
      const rows = result.reflections.map((text) => ({
        raw_entry_id: entry.id,
        user_id: userId,
        text,
      }));
      const ins = await supabase.from("reflections").insert(rows);
      if (ins.error) throw new Error(ins.error.message);
    }

    // 6. 기존 파생 데이터 삭제 — 새 데이터 삽입 성공 후.
    if (oldEventIds.length > 0) {
      const del = await supabase.from("events").delete().in("id", oldEventIds);
      if (del.error) throw new Error(del.error.message);
    }
    if (oldUnparsedIds.length > 0) {
      const del = await supabase.from("unparsed_fragments").delete().in("id", oldUnparsedIds);
      if (del.error) throw new Error(del.error.message);
    }
    if (oldReflectionIds.length > 0) {
      const del = await supabase.from("reflections").delete().in("id", oldReflectionIds);
      if (del.error) throw new Error(del.error.message);
    }

    // 7. parse_version 갱신.
    const upd = await supabase
      .from("raw_entries")
      .update({ parse_version: result.parse_version, parsed_at: kstNowIso(), parse_error: null })
      .eq("id", entry.id);
    if (upd.error) throw new Error(upd.error.message);

    // 8. 대상 추출(thing-extract). 파싱과 분리된 별도 단계. 실패해도 파싱 결과는 보존된다.
    let thingsCount: number | undefined;
    try {
      thingsCount = await persistThings(supabase, userId, entry.id, entry.transcript);
    } catch (err) {
      const thingErrMsg = err instanceof Error ? err.message : String(err);
      console.warn("[reparseEntry] thing 추출 실패 (파싱 결과 유지):", thingErrMsg);
      // parse_error 와 같은 방식으로 thing_extract_error 에 기록한다. (0017)
      await supabase
        .from("raw_entries")
        .update({ thing_extract_error: thingErrMsg })
        .eq("id", entry.id);
    }

    return {
      raw_entry_id: entry.id,
      ok: true,
      events: result.events.length,
      hypotheses: result.hypotheses.length,
      unparsed: result.unparsed.length,
      reflections: result.reflections.length,
      things: thingsCount,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // 파싱/삽입 실패 시 원문은 건드리지 않고 parse_error 만 기록한다.
    await supabase
      .from("raw_entries")
      .update({ parse_version: PARSE_VERSION, parsed_at: kstNowIso(), parse_error: message })
      .eq("id", entry.id);
    return { raw_entry_id: entry.id, ok: false, error: message };
  }
}

/**
 * mention 수를 다시 세어 hypotheses 를 갱신한다. mention 이 0이 된 **open** 가설은 삭제한다
 * (파생 데이터). recent_statement 는 남은 최신 mention 의 표현으로 맞춘다.
 * 검증/기각된(non-open) 가설은 status 가드로 삭제하지 않는다.
 */
async function recountHypothesis(supabase: SupabaseClient, hypId: string): Promise<void> {
  const { data, error } = await supabase
    .from("hypothesis_mentions")
    .select("statement, created_at")
    .eq("hypothesis_id", hypId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { statement: string | null; created_at: string }[];

  if (rows.length === 0) {
    const del = await supabase.from("hypotheses").delete().eq("id", hypId).eq("status", "open");
    if (del.error) throw new Error(del.error.message);
    return;
  }
  const upd = await supabase
    .from("hypotheses")
    .update({ mention_count: rows.length, recent_statement: rows[0]!.statement })
    .eq("id", hypId);
  if (upd.error) throw new Error(upd.error.message);
}

/**
 * 가설 의미 병합. (기능 [1])
 *
 * insert-before-delete 패턴: 새 mention 을 삽입한 뒤에 불필요해진 기존 mention 을 삭제한다.
 * 삽입이 실패해도 기존 데이터가 보존된다.
 *
 * 1) 이 원문이 open 가설에 붙인 기존 mention ID 수집(아직 삭제 안 함).
 * 2) incoming 이 있으면 매칭(LLM) 후 새 mention 삽입/upsert.
 * 3) 이번 파싱에서 다루지 않은 기존 mention 삭제.
 * 4) 영향받은 가설 전체 재계산.
 *
 * ⚠️ 동시성: 두 원문이 동시에 파싱되면 같은 의심을 각각 새로 만들 미세한 레이스가 있다.
 *    가족 3명 + 배치 순차 + 백그라운드 대개 1건씩이라 실사용 위험은 낮아 지금은 방치한다.
 *    (필요해지면 advisory lock 추가) 트랜잭션도 없다 — 중간 실패 시 부분 갱신은 재파싱으로 복구.
 */
async function persistHypotheses(
  supabase: SupabaseClient,
  userId: string,
  entryId: string,
  incoming: ParsedHypothesis[],
): Promise<void> {
  // 1) 기존 open mention ID 수집. hypothesis_id → mention_id 맵. 아직 삭제하지 않는다.
  const { data: myMentions, error: mErr } = await supabase
    .from("hypothesis_mentions")
    .select("id, hypothesis_id, hypotheses!inner(status)")
    .eq("raw_entry_id", entryId)
    .eq("hypotheses.status", "open");
  if (mErr) throw new Error(mErr.message);

  // hypothesis_id → mention_id (이번 원문에서 이 가설에 붙은 기존 mention)
  const oldHypMentionMap = new Map<string, string>();
  for (const row of (myMentions ?? []) as { id: string; hypothesis_id: string }[]) {
    oldHypMentionMap.set(row.hypothesis_id, row.id);
  }
  const oldHypIds = new Set(oldHypMentionMap.keys());

  // incoming 이 없으면: 기존 mention 정리 후 종료.
  // (새 데이터가 없으므로 삭제 먼저도 데이터 소실 없음)
  if (incoming.length === 0) {
    const mentionIds = [...oldHypMentionMap.values()];
    if (mentionIds.length > 0) {
      const del = await supabase.from("hypothesis_mentions").delete().in("id", mentionIds);
      if (del.error) throw new Error(del.error.message);
    }
    for (const hypId of oldHypIds) await recountHypothesis(supabase, hypId);
    return;
  }

  // 2) 매칭 후보: 같은 user 의 open 가설 상위 30건(많이 의심한 것 우선).
  const { data: existing, error: exErr } = await supabase
    .from("hypotheses")
    .select("id, cause_hint, effect_hint")
    .eq("user_id", userId)
    .eq("status", "open")
    .order("mention_count", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(30);
  if (exErr) throw new Error(exErr.message);
  const candidates = (existing ?? []) as {
    id: string;
    cause_hint: string | null;
    effect_hint: string | null;
  }[];

  // 3) 의미 매칭(후보가 있을 때만 LLM 호출). 실패해도 전부 null 폴백(병합 없이 새로 생성).
  let matchedIds: (string | null)[];
  if (candidates.length === 0) {
    matchedIds = incoming.map(() => null);
  } else {
    try {
      matchedIds = await matchHypotheses(candidates, incoming);
    } catch (err) {
      console.warn("[persist] 가설 매칭 실패 — 병합 없이 새로 생성:", err);
      matchedIds = incoming.map(() => null);
    }
  }

  // 4) 새 mention 삽입/upsert — 기존 mention 삭제 전에.
  //    같은 가설이 이번에도 매칭되면 upsert 가 기존 행을 업데이트한다(삭제 대상 제외).
  const matchedHypIds = new Set<string>();
  for (let i = 0; i < incoming.length; i++) {
    const h = incoming[i]!;
    const matchedId = matchedIds[i] ?? null;
    if (matchedId) {
      // 같은 원문은 같은 의심에 한 번만(unique) — upsert 로 중복 카운트 방지.
      const up = await supabase.from("hypothesis_mentions").upsert(
        { hypothesis_id: matchedId, raw_entry_id: entryId, user_id: userId, statement: h.statement },
        { onConflict: "hypothesis_id,raw_entry_id" },
      );
      if (up.error) throw new Error(up.error.message);
      matchedHypIds.add(matchedId);
    } else {
      const insHyp = await supabase
        .from("hypotheses")
        .insert({
          raw_entry_id: entryId, // 최초 생성 원문(origin)
          user_id: userId,
          statement: h.statement,
          recent_statement: h.statement,
          cause_hint: h.cause_hint,
          effect_hint: h.effect_hint,
          mention_count: 1,
        })
        .select("id")
        .single();
      if (insHyp.error) throw new Error(insHyp.error.message);
      const newId = (insHyp.data as { id: string }).id;
      const insM = await supabase.from("hypothesis_mentions").insert({
        hypothesis_id: newId,
        raw_entry_id: entryId,
        user_id: userId,
        statement: h.statement,
      });
      if (insM.error) throw new Error(insM.error.message);
      matchedHypIds.add(newId);
    }
  }

  // 5) 이번 파싱에서 매칭되지 않은 기존 mention 삭제.
  //    upsert 된 가설(matchedHypIds)의 mention 은 업데이트됐으므로 삭제하지 않는다.
  const mentionIdsToDelete: string[] = [];
  for (const [hypId, mentionId] of oldHypMentionMap) {
    if (!matchedHypIds.has(hypId)) mentionIdsToDelete.push(mentionId);
  }
  if (mentionIdsToDelete.length > 0) {
    const del = await supabase.from("hypothesis_mentions").delete().in("id", mentionIdsToDelete);
    if (del.error) throw new Error(del.error.message);
  }

  // 6) 재계산 — 기존 + 새로 생성된 가설 전체. 삭제 후에 해야 count 가 정확하다.
  const allAffected = new Set([...oldHypIds, ...matchedHypIds]);
  for (const hypId of allAffected) await recountHypothesis(supabase, hypId);
}
