import "server-only";
import { getSupabaseClient } from "@/lib/db/client";
import { env } from "@/lib/env";
import { excludeHidden } from "@/lib/db/filters";
import type { Category, Hypothesis, RawEntry, UnparsedFragment } from "@/lib/db/schema";

/** 타임라인 표시용 이벤트(행 그대로, payload 는 jsonb 이므로 느슨하게). */
export interface TimelineEvent {
  id: string;
  category: Category;
  occurred_at: string;
  occurred_at_precision: string;
  payload: Record<string, unknown>;
  confidence: number;
  needs_review: boolean;
  corrected_by_user: boolean;
}

export interface TimelineData {
  entry: RawEntry;
  events: TimelineEvent[];
  hypotheses: Hypothesis[];
  unparsed: UnparsedFragment[];
}

/** 오늘 날짜(KST) 를 YYYY-MM-DD 로. */
export function todayKstDate(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** YYYY-MM-DD(KST) 하루 구간 [00:00, 다음날 00:00) 을 UTC ISO 로. */
function kstDayRange(date: string): [string, string] {
  const start = new Date(`${date}T00:00:00+09:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return [start.toISOString(), end.toISOString()];
}

function groupBy<T>(rows: T[], key: (r: T) => string | null): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    if (k == null) continue;
    const list = map.get(k);
    if (list) list.push(r);
    else map.set(k, [r]);
  }
  return map;
}

/**
 * 해당 날짜(KST)의 raw_entries 를 시간 역순으로, 각 원문에서 나온
 * events / hypotheses / unparsed_fragments 와 함께 반환한다. (기획서 §4.1)
 * 서버 전용(service role). 브라우저는 이 함수를 직접 호출하지 않는다.
 */
export async function getDayTimeline(date: string, includeHidden = false): Promise<TimelineData[]> {
  const supabase = getSupabaseClient();
  const userId = env.userId();
  const [start, end] = kstDayRange(date);

  let entriesQuery = supabase
    .from("raw_entries")
    .select("*")
    .eq("user_id", userId)
    .gte("recorded_at", start)
    .lt("recorded_at", end);
  // 기본은 숨긴 원문 제외. "숨긴 항목 보기" 토글일 때만 포함한다.
  if (!includeHidden) entriesQuery = excludeHidden(entriesQuery);

  const { data: entries, error } = await entriesQuery.order("recorded_at", { ascending: false });
  if (error) throw new Error(error.message);
  const rawEntries = (entries ?? []) as RawEntry[];
  if (rawEntries.length === 0) return [];

  const ids = rawEntries.map((e) => e.id);
  const [eventsRes, hypRes, unparsedRes] = await Promise.all([
    supabase.from("events").select("*").in("raw_entry_id", ids).order("occurred_at"),
    supabase.from("hypotheses").select("*").in("raw_entry_id", ids),
    supabase.from("unparsed_fragments").select("*").in("raw_entry_id", ids),
  ]);
  if (eventsRes.error) throw new Error(eventsRes.error.message);
  if (hypRes.error) throw new Error(hypRes.error.message);
  if (unparsedRes.error) throw new Error(unparsedRes.error.message);

  const eventRows = (eventsRes.data ?? []) as (TimelineEvent & { raw_entry_id: string })[];
  const eventsByEntry = groupBy(eventRows, (e) => e.raw_entry_id);
  const hypByEntry = groupBy((hypRes.data ?? []) as Hypothesis[], (h) => h.raw_entry_id);
  const unparsedByEntry = groupBy(
    (unparsedRes.data ?? []) as UnparsedFragment[],
    (u) => u.raw_entry_id,
  );

  return rawEntries.map((entry) => ({
    entry,
    events: eventsByEntry.get(entry.id) ?? [],
    hypotheses: hypByEntry.get(entry.id) ?? [],
    unparsed: unparsedByEntry.get(entry.id) ?? [],
  }));
}
