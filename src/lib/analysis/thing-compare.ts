/**
 * 대상(thing) 상세 분석 — "이 대상을 원인으로 고정하고 결과들을 비교"
 *
 * 대시보드의 compareOutcome 은 "결과를 고정하고 원인들을 비교"한다.
 * 이 모듈은 축을 뒤집어 "원인(thing)을 고정하고 결과들을 비교"한다.
 *
 * ⚠️ 같은 설계 원칙: 단순 빈도/평균만 계산한다. 상관계수·p값·"유의미함" 판정 없음.
 *    표본이 작아 그런 값은 반드시 헛것을 본다. (compare.ts 주석 참고)
 */
import { OUTCOMES, kstDateOf, readScaleValue, type AnalysisEvent, type OutcomeDef } from "./outcomes";
import { normalize } from "@/lib/parser/thing-extract";

export const THING_MIN_SAMPLES = 5;

/** thing 이름 매칭이 적용되는 카테고리와 해당 이름 필드. */
const NAME_FIELDS: Record<string, string> = {
  food: "name",
  medication: "name",
  activity: "name",
  body_care: "action_text",
};

/** 이벤트가 this thing 의 이름·aliases 와 일치하는가. */
export function isThingEvent(e: AnalysisEvent, normNames: Set<string>): boolean {
  const field = NAME_FIELDS[e.category];
  if (!field) return false;
  const n = e.payload[field];
  if (typeof n !== "string" || !n.trim()) return false;
  return normNames.has(normalize(n.trim()));
}

export type AxisMode = "use_vs_nonuse" | "once_vs_multi" | "insufficient";

export interface ThingGroupStats {
  label: string;
  total: number;        // 이 그룹에 속한 날 수 (축 결정 기준)
  withOutcome: number;  // 결과 데이터가 있는 날 수 (scale: outcome 값이 있는 날, presence: 전체 날)
  mean: number | null;  // scale 평균 (소수점 1자리). null: 데이터 없거나 presence 결과
  presenceCount: number; // presence: 증상 있는 날 수
}

export interface ThingOutcomeRow {
  outcome: OutcomeDef;
  groupA: ThingGroupStats;
  groupB: ThingGroupStats;
  /** true = 양쪽 모두 THING_MIN_SAMPLES 이상. false 면 화면이 흐리게 + "표본 부족" 표시. */
  enoughData: boolean;
}

export interface TimeDistribution {
  morning: number;   // 오전 6–11
  lunch: number;     // 점심 11–14
  afternoon: number; // 오후 14–18
  evening: number;   // 저녁 18–22
  night: number;     // 밤·새벽 나머지
}

export interface AmountEntry {
  text: string;
  count: number;
}

export interface ThingCompareResult {
  // ── 요약 ─────────────────────────────────────────────────────────────────
  totalEventCount: number;
  useDayCount: number;
  totalPeriodDays: number;
  firstUseDate: string | null; // KST YYYY-MM-DD
  lastUseDate: string | null;
  timeDistribution: TimeDistribution;
  amountTexts: AmountEntry[]; // amount_text 원문, 상위 5개

  // ── 빈도 추이 ─────────────────────────────────────────────────────────────
  dailyCounts: { date: string; count: number }[];

  // ── 비교 축 ──────────────────────────────────────────────────────────────
  axisMode: AxisMode;
  axisSwitchReason?: string;
  groupALabel: string;
  groupBLabel: string;

  // ── 결과별 비교 ──────────────────────────────────────────────────────────
  outcomeRows: ThingOutcomeRow[];
}

// ── 내부 헬퍼 ─────────────────────────────────────────────────────────────────

function shiftYmd(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function todayKst(override?: string): string {
  return override ?? new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function kstHour(iso: string): number {
  return new Date(Date.parse(iso) + 9 * 60 * 60 * 1000).getUTCHours();
}

function timeSlot(hour: number): keyof TimeDistribution {
  if (hour >= 6 && hour < 11) return "morning";
  if (hour >= 11 && hour < 14) return "lunch";
  if (hour >= 14 && hour < 18) return "afternoon";
  if (hour >= 18 && hour < 22) return "evening";
  return "night";
}

function computeGroupStats(
  outcome: OutcomeDef,
  groupDays: Set<string>,
  eventsByDay: Map<string, AnalysisEvent[]>,
  label: string,
): ThingGroupStats {
  let withOutcome = 0;
  let sum = 0;
  let presenceCount = 0;

  for (const day of groupDays) {
    const dayEvents = eventsByDay.get(day) ?? [];

    if (outcome.kind === "scale") {
      const vals = dayEvents
        .filter((e) => e.category === outcome.category)
        .map((e) => readScaleValue(outcome, e.payload))
        .filter((v): v is number => v != null);
      if (vals.length > 0) {
        withOutcome++;
        sum += vals.reduce((a, b) => a + b, 0) / vals.length;
      }
    } else {
      // presence: 분모는 그룹 전체 날 (withOutcome = total로 처리)
      const hasIt = dayEvents.some(
        (e) => e.category === outcome.category && outcome.match(e.payload),
      );
      if (hasIt) presenceCount++;
    }
  }

  const mean =
    outcome.kind === "scale" && withOutcome > 0
      ? Math.round((sum / withOutcome) * 10) / 10
      : null;

  return {
    label,
    total: groupDays.size,
    withOutcome: outcome.kind === "scale" ? withOutcome : groupDays.size,
    mean,
    presenceCount,
  };
}

// ── 메인 함수 ─────────────────────────────────────────────────────────────────

/**
 * thing 을 원인으로 고정하고, 각 결과 지표의 "사용 날 vs 미사용 날" 분포를 계산한다.
 *
 * @param events       getEventsForAnalysis 가 준 전체 이벤트(period 포함)
 * @param normNames    thing.name + aliases 를 normalize 한 집합
 * @param periodDays   분석 기간(일). 오늘 포함 최근 N일
 * @param today        KST 오늘(테스트용 주입). 생략 시 실제 오늘
 */
export function compareThingOutcomes(
  events: AnalysisEvent[],
  normNames: Set<string>,
  periodDays: number,
  today?: string,
): ThingCompareResult {
  const todayStr = todayKst(today);

  // 기간 날짜 배열 (오름차순)
  const periodDaysArr: string[] = [];
  for (let i = periodDays - 1; i >= 0; i--) periodDaysArr.push(shiftYmd(todayStr, -i));
  const periodDaysSet = new Set(periodDaysArr);

  // thing 이벤트(기간 안) 필터
  const thingEvents = events.filter(
    (e) => isThingEvent(e, normNames) && periodDaysSet.has(kstDateOf(e.occurred_at)),
  );

  // 날짜별 횟수
  const dayCountMap = new Map<string, number>();
  for (const e of thingEvents) {
    const d = kstDateOf(e.occurred_at);
    dayCountMap.set(d, (dayCountMap.get(d) ?? 0) + 1);
  }

  const useDays = new Set(dayCountMap.keys());
  const nonUseDays = new Set(periodDaysArr.filter((d) => !useDays.has(d)));
  const onceDays = new Set(
    [...dayCountMap.entries()].filter(([, c]) => c === 1).map(([d]) => d),
  );
  const multiDays = new Set(
    [...dayCountMap.entries()].filter(([, c]) => c >= 2).map(([d]) => d),
  );

  // 축 결정
  let axisMode: AxisMode;
  let groupALabel: string;
  let groupBLabel: string;
  let axisSwitchReason: string | undefined;
  let groupADays: Set<string>;
  let groupBDays: Set<string>;

  if (nonUseDays.size >= THING_MIN_SAMPLES) {
    axisMode = "use_vs_nonuse";
    groupALabel = "사용한 날";
    groupBLabel = "사용 안 한 날";
    groupADays = useDays;
    groupBDays = nonUseDays;
  } else if (onceDays.size >= THING_MIN_SAMPLES || multiDays.size >= THING_MIN_SAMPLES) {
    axisMode = "once_vs_multi";
    groupALabel = "1회";
    groupBLabel = "2회 이상";
    groupADays = onceDays;
    groupBDays = multiDays;
    axisSwitchReason =
      "거의 매일 사용해서 사용/미사용 비교가 어려워요. 사용량으로 비교합니다.";
  } else {
    axisMode = "insufficient";
    groupALabel = "";
    groupBLabel = "";
    groupADays = new Set();
    groupBDays = new Set();
  }

  // 날짜별 이벤트 맵 (결과 계산용)
  const eventsByDay = new Map<string, AnalysisEvent[]>();
  for (const e of events) {
    const d = kstDateOf(e.occurred_at);
    if (!periodDaysSet.has(d)) continue;
    const list = eventsByDay.get(d);
    if (list) list.push(e);
    else eventsByDay.set(d, [e]);
  }

  // 결과별 비교
  const outcomeRows: ThingOutcomeRow[] = OUTCOMES.map((outcome) => {
    const groupA = computeGroupStats(outcome, groupADays, eventsByDay, groupALabel);
    const groupB = computeGroupStats(outcome, groupBDays, eventsByDay, groupBLabel);
    return {
      outcome,
      groupA,
      groupB,
      enoughData: groupA.total >= THING_MIN_SAMPLES && groupB.total >= THING_MIN_SAMPLES,
    };
  });

  // 요약
  const totalEventCount = thingEvents.length;
  const useDayCount = useDays.size;
  const useDatesArr = [...useDays].sort();
  const firstUseDate = useDatesArr[0] ?? null;
  const lastUseDate = useDatesArr[useDatesArr.length - 1] ?? null;

  // 시간대 분포
  const timeDistribution: TimeDistribution = {
    morning: 0,
    lunch: 0,
    afternoon: 0,
    evening: 0,
    night: 0,
  };
  for (const e of thingEvents) {
    timeDistribution[timeSlot(kstHour(e.occurred_at))]++;
  }

  // 양 표현 원문 집계 (amount_text)
  const amountMap = new Map<string, number>();
  for (const e of thingEvents) {
    const t = e.payload.amount_text;
    if (typeof t === "string" && t.trim()) {
      const key = t.trim();
      amountMap.set(key, (amountMap.get(key) ?? 0) + 1);
    }
  }
  const amountTexts = [...amountMap.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([text, count]) => ({ text, count }));

  // 빈도 추이 (기간 전체 날짜)
  const dailyCounts = periodDaysArr.map((date) => ({
    date,
    count: dayCountMap.get(date) ?? 0,
  }));

  return {
    totalEventCount,
    useDayCount,
    totalPeriodDays: periodDays,
    firstUseDate,
    lastUseDate,
    timeDistribution,
    amountTexts,
    dailyCounts,
    axisMode,
    axisSwitchReason,
    groupALabel,
    groupBLabel,
    outcomeRows,
  };
}
