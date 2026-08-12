import type { SupabaseClient } from "@supabase/supabase-js";
import { parseTranscript, PARSE_VERSION } from "@/lib/parser";
import type { RawEntry } from "@/lib/db/schema";

/**
 * raw_entry 하나를 파싱하고 파생 데이터를 재생성한다. (기획서 §5.1)
 *  - events, unparsed_fragments 는 파생 데이터: DELETE 후 재삽입.
 *  - hypotheses 는 status 가 open 인 것만 지우고 재삽입. (검증/기각된 가설은 유지)
 *  - raw_entries 는 parse_version / parsed_at / parse_error 만 갱신. (0002 트리거 허용 컬럼)
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
    const result = await parseTranscript(entry.transcript, entry.recorded_at, {
      cachePrompt: opts.cachePrompt ?? false,
    });

    const delEvents = await supabase.from("events").delete().eq("raw_entry_id", entry.id);
    if (delEvents.error) throw new Error(delEvents.error.message);

    const delHyp = await supabase
      .from("hypotheses")
      .delete()
      .eq("raw_entry_id", entry.id)
      .eq("status", "open");
    if (delHyp.error) throw new Error(delHyp.error.message);

    const delUnparsed = await supabase
      .from("unparsed_fragments")
      .delete()
      .eq("raw_entry_id", entry.id);
    if (delUnparsed.error) throw new Error(delUnparsed.error.message);

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

    if (result.hypotheses.length > 0) {
      const rows = result.hypotheses.map((h) => ({
        raw_entry_id: entry.id,
        user_id: userId,
        statement: h.statement,
        cause_hint: h.cause_hint,
        effect_hint: h.effect_hint,
      }));
      const ins = await supabase.from("hypotheses").insert(rows);
      if (ins.error) throw new Error(ins.error.message);
    }

    if (result.unparsed.length > 0) {
      const rows = result.unparsed.map((text) => ({
        raw_entry_id: entry.id,
        user_id: userId,
        text,
      }));
      const ins = await supabase.from("unparsed_fragments").insert(rows);
      if (ins.error) throw new Error(ins.error.message);
    }

    const upd = await supabase
      .from("raw_entries")
      .update({ parse_version: result.parse_version, parsed_at: kstNowIso(), parse_error: null })
      .eq("id", entry.id);
    if (upd.error) throw new Error(upd.error.message);

    return {
      raw_entry_id: entry.id,
      ok: true,
      events: result.events.length,
      hypotheses: result.hypotheses.length,
      unparsed: result.unparsed.length,
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
