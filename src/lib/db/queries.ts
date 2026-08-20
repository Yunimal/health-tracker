import "server-only";
import { getSupabaseClient } from "@/lib/db/client";
import { excludeHidden } from "@/lib/db/filters";
import { eventName } from "@/lib/format";
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
export async function getDayTimeline(
  userId: string,
  date: string,
  includeHidden = false,
): Promise<TimelineData[]> {
  const supabase = getSupabaseClient();
  const [start, end] = kstDayRange(date);

  let entriesQuery = supabase
    .from("raw_entries")
    .select("*")
    .eq("user_id", userId)
    .gte("recorded_at", start)
    .lt("recorded_at", end);
  // 기본은 숨긴 원문 제외. "숨긴 항목 보기" 토글일 때만 포함한다.
  if (!includeHidden) entriesQuery = excludeHidden(entriesQuery);

  // [perf] 계측: 쿼리별/전체 소요 시간을 Vercel Logs 에서 볼 수 있게 찍는다.
  // 구조: (1) raw_entries 1회 → (2) events/hypotheses/unparsed 3개 병렬(Promise.all).
  // 즉 순차 왕복은 4회가 아니라 2회다. Supabase(서울)와 함수 리전이 다르면 매 왕복이 태평양 횡단.
  const tStart = performance.now();

  const tEntries0 = performance.now();
  const { data: entries, error } = await entriesQuery.order("recorded_at", { ascending: false });
  const tEntries = performance.now() - tEntries0;
  if (error) throw new Error(error.message);
  const rawEntries = (entries ?? []) as RawEntry[];
  if (rawEntries.length === 0) {
    console.log(
      `[perf] getDayTimeline date=${date} entries=${tEntries.toFixed(0)}ms rows=0 total=${(performance.now() - tStart).toFixed(0)}ms`,
    );
    return [];
  }

  const ids = rawEntries.map((e) => e.id);
  const tRest0 = performance.now();
  const [eventsRes, hypRes, unparsedRes] = await Promise.all([
    supabase.from("events").select("*").in("raw_entry_id", ids).order("occurred_at"),
    supabase.from("hypotheses").select("*").in("raw_entry_id", ids),
    supabase.from("unparsed_fragments").select("*").in("raw_entry_id", ids),
  ]);
  const tRest = performance.now() - tRest0;
  if (eventsRes.error) throw new Error(eventsRes.error.message);
  if (hypRes.error) throw new Error(hypRes.error.message);
  if (unparsedRes.error) throw new Error(unparsedRes.error.message);

  console.log(
    `[perf] getDayTimeline date=${date} rows=${rawEntries.length}` +
      ` entries=${tEntries.toFixed(0)}ms rest_3parallel=${tRest.toFixed(0)}ms` +
      ` total=${(performance.now() - tStart).toFixed(0)}ms`,
  );

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

// ── 가설 (hypotheses) ────────────────────────────────────────────────────────

/** 사용자의 가설 전체를 최근순으로. 상태별 정렬/그룹핑은 화면(page)이 한다. */
export async function getHypotheses(userId: string): Promise<Hypothesis[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("hypotheses")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Hypothesis[];
}

/** open(아직 판단 안 한) 가설 수. 메인 화면의 "가설 N개" 링크에 쓴다. */
export async function getOpenHypothesisCount(userId: string): Promise<number> {
  const supabase = getSupabaseClient();
  const { count, error } = await supabase
    .from("hypotheses")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "open");
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** cause 시점 기준 ±12시간 안의, 다른 카테고리 이벤트 1건. */
export interface AroundEvent extends TimelineEvent {
  delta_ms: number; // cause 발생 시각 기준 상대 시각(양수 = 그 뒤에 일어남)
}

/** cause 후보 이벤트 1건과, 그 전후 12시간 안에 일어난 다른 카테고리 이벤트들. */
export interface CauseOccurrence {
  cause: TimelineEvent;
  around: AroundEvent[];
}

export interface HypothesisDetail {
  hypothesis: Hypothesis;
  matchedNames: string[]; // cause_hint 와 이름이 겹쳐 원인 후보로 잡힌 이벤트 이름들
  occurrences: CauseOccurrence[]; // 시간순
  distinctDays: number; // cause 후보가 나타난 서로 다른 날 수 (표본 수 표시용)
}

const CAUSE_WINDOW_MS = 12 * 60 * 60 * 1000;
const normName = (s: string | null): string => (s ?? "").replace(/\s+/g, "");
const kstDayKey = (iso: string): string =>
  new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

/**
 * 가설 1건 + "나란히 보여주기"용 데이터. **상관/확률을 계산하지 않는다.**
 * cause_hint 와 이름이 겹치는 이벤트(원인 후보)를 찾고, 각 발생 시점 전후 12시간 안의
 * 다른 카테고리 이벤트를 그대로 모아 시간순으로 돌려준다. 판단은 사용자가 한다. (기획서 §3)
 * 없는 가설이면 null. 서버 전용(service role).
 */
export async function getHypothesisDetail(
  userId: string,
  hypothesisId: string,
): Promise<HypothesisDetail | null> {
  const supabase = getSupabaseClient();

  const { data: hypRow, error: hErr } = await supabase
    .from("hypotheses")
    .select("*")
    .eq("id", hypothesisId)
    .eq("user_id", userId)
    .maybeSingle();
  if (hErr) throw new Error(hErr.message);
  if (!hypRow) return null;
  const hypothesis = hypRow as Hypothesis;

  const { data: evRows, error: eErr } = await supabase
    .from("events")
    .select("*")
    .eq("user_id", userId)
    .order("occurred_at");
  if (eErr) throw new Error(eErr.message);
  const events = (evRows ?? []) as TimelineEvent[];

  const time = (e: TimelineEvent): number => new Date(e.occurred_at).getTime();
  const causeNorm = normName(hypothesis.cause_hint);

  // 원인 후보 = cause_hint 안에 이름이 통째로 들어가는 이벤트. (부분 문자열 매칭, 2자 이상)
  // 지어내지 않는다: 겹치는 게 없으면 후보도 없다. 사용자가 직접 보고 판단하게 둔다.
  const matched = causeNorm
    ? events.filter((e) => {
        const nn = normName(eventName(e.category, e.payload));
        return nn.length >= 2 && causeNorm.includes(nn);
      })
    : [];

  const occurrences: CauseOccurrence[] = matched
    .map((cause) => {
      const ct = time(cause);
      const around: AroundEvent[] = events
        .filter(
          (o) =>
            o.id !== cause.id &&
            o.category !== cause.category &&
            Math.abs(time(o) - ct) <= CAUSE_WINDOW_MS,
        )
        .map((o) => ({ ...o, delta_ms: time(o) - ct }))
        .sort((a, b) => time(a) - time(b));
      return { cause, around };
    })
    .sort((a, b) => time(a.cause) - time(b.cause));

  const distinctDays = new Set(matched.map((e) => kstDayKey(e.occurred_at))).size;
  const matchedNames = [
    ...new Set(matched.map((e) => eventName(e.category, e.payload)).filter((n): n is string => !!n)),
  ];

  return { hypothesis, matchedNames, occurrences, distinctDays };
}
