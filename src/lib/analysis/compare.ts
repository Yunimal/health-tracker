/**
 * 결과별 좋은 날 / 나쁜 날 비교 — "결과 ← 원인" 축 분석의 계산부.
 *
 * ⚠️ 계산하는 것은 **단순 빈도(N일 중 M일)뿐이다.** 상관계수·p값·신뢰구간·"유의미함" 같은
 *    통계 판정을 만들지 않는다. 표본이 작아(대부분 한 자릿수) 그런 값은 반드시 헛것을 본다.
 *    (사용자 지시, CLAUDE.md 원칙 6, docs/analysis-design.md)
 *
 *  - goodDays/badDays: 결과가 좋았던/나빴던 날. 중간(middle)은 어느 쪽도 아니어서 제외한다.
 *  - unknownDays: 결과 기록이 없는 날. **"모르는 날"을 "좋았던 날"에 넣지 않는다.**
 *  - factors[].difference: good/bad 등장 비율의 차이. **정렬용일 뿐 점수가 아니다.**
 *  - enoughData: good/bad 각 그룹이 5일 이상인가. 미만이면 화면은 비교표 대신
 *    "아직 판단하기 이릅니다"를 보여준다.
 */
import {
  classifyScaleValue,
  getOutcome,
  kstDateOf,
  readScaleValue,
  type AnalysisEvent,
} from "./outcomes";
import { extractInputFactors, type InputFactorOptions } from "./inputs";

export const MIN_SAMPLES = 5; // 각 그룹(good/bad) 최소 표본 일수

// presence 결과에서 "없었음(good)"으로 인정하기 위한 그날 최소 기록 밀도.
// "말하지 않은 것"과 "없었던 것"을 구분할 방법이 없다. 기록이 1건뿐인 날을 "갈망 없던 날"로
// 세면 goodDays 가 부풀려져 비교표가 실제와 반대로 나올 수 있다. 기록이 충분한 날에 안
// 나타났다면 없었다고 볼 근거가 조금 더 생긴다. 3은 잠정값 — 실제 데이터를 보고 조정한다.
export const PRESENCE_GOOD_MIN_EVENTS = 3;

export interface FactorComparison {
  id: string;
  label: string;
  goodCount: number; // 좋았던 날 중 이 factor 가 창 안에 있었던 날 수
  goodTotal: number; // 좋았던 날 총수
  badCount: number;
  badTotal: number;
  difference: number; // (goodCount/goodTotal) − (badCount/badTotal). 정렬용. 점수 아님.
}

/** 분류된 하루. 상세 화면이 lookback 창을 다시 만들 때 anchor 를 쓴다. */
export interface ClassifiedDay {
  date: string;
  group: "good" | "bad";
  anchor: string; // 이 날 결과 시점(창의 끝)
}

export interface OutcomeComparison {
  goodDays: string[];
  badDays: string[];
  unknownDays: string[];
  classified: ClassifiedDay[]; // good + bad, anchor 포함(상세용)
  factors: FactorComparison[];
  enoughData: boolean;
  minSamplesNeeded: number;
}

export interface CompareOptions extends InputFactorOptions {
  /** 오늘(KST YYYY-MM-DD). 테스트 결정성을 위해 주입 가능. 기본은 실제 오늘. */
  today?: string;
}

/** 이벤트가 anchor 시점 기준 lookbackHours 창 [anchor−lookback, anchor] 안에 드는가. */
export function withinLookback(eventIso: string, anchorIso: string, lookbackHours: number): boolean {
  const t = Date.parse(eventIso);
  const a = Date.parse(anchorIso);
  return t <= a && t >= a - lookbackHours * 60 * 60 * 1000;
}

/** YYYY-MM-DD 를 days 만큼 이동(UTC 순수 산술). */
function shiftYmd(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function todayKst(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** 그날의 끝(23:59:59.999 KST). presence 결과의 lookback anchor 로 쓴다. */
function endOfDayIso(day: string): string {
  return `${day}T23:59:59.999+09:00`;
}

interface DayAnchor {
  day: string;
  anchor: string; // 이 날 결과 시점(창의 끝)
}

/**
 * 하나의 결과에 대해 좋은 날/나쁜 날을 가르고, 각 원인 후보가 두 그룹에서 며칠씩 나타났는지 센다.
 */
export function compareOutcome(
  outcomeId: string,
  events: AnalysisEvent[],
  periodDays: number,
  options: CompareOptions = {},
): OutcomeComparison {
  const def = getOutcome(outcomeId);
  if (!def) throw new Error(`알 수 없는 outcome: ${outcomeId}`);

  const today = options.today ?? todayKst();
  // 기간 달력: 오늘 포함 최근 periodDays 일.
  const days: string[] = [];
  for (let i = periodDays - 1; i >= 0; i--) days.push(shiftYmd(today, -i));
  const inPeriod = new Set(days);

  // 날짜별 이벤트 그룹핑(기간 안의 날만).
  const byDay = new Map<string, AnalysisEvent[]>();
  for (const e of events) {
    const d = kstDateOf(e.occurred_at);
    if (!inPeriod.has(d)) continue;
    const list = byDay.get(d);
    if (list) list.push(e);
    else byDay.set(d, [e]);
  }

  const good: DayAnchor[] = [];
  const bad: DayAnchor[] = [];
  const unknownDays: string[] = [];

  for (const day of days) {
    const dayEvents = byDay.get(day) ?? [];

    if (def.kind === "scale") {
      const outcomeEvents = dayEvents.filter((e) => e.category === def.category);
      const values = outcomeEvents
        .map((e) => readScaleValue(def, e.payload))
        .filter((v): v is number => v != null);
      if (values.length === 0) {
        unknownDays.push(day); // 결과(값) 기록이 없는 날
        continue;
      }
      // 하루에 여러 건이면 평균값으로 분류하고, 창의 끝(anchor)은 가장 늦은 관찰 시각으로.
      const mean = values.reduce((s, v) => s + v, 0) / values.length;
      const anchor = outcomeEvents
        .map((e) => e.occurred_at)
        .sort((a, b) => Date.parse(b) - Date.parse(a))[0]!;
      const cls = classifyScaleValue(def, mean);
      if (cls === "good") good.push({ day, anchor });
      else if (cls === "bad") bad.push({ day, anchor });
      // middle → 어느 그룹에도 넣지 않는다(좋다고도 나쁘다고도 할 수 없음).
    } else {
      // presence: 매칭 이벤트가 있으면 나쁜 날. 없으면 그날 기록이 충분(≥임계)할 때만 좋은
      // 날로 인정하고, 1~2건이면 판단을 보류(unknown)한다 — 기록이 적은 날의 "없음"은
      // "말하지 않았을" 가능성이 커서 goodDays 를 부풀린다. anchor 는 good/bad 대칭을 위해
      // 둘 다 그날의 끝으로 둔다.
      const hasMatch = dayEvents.some((e) => e.category === def.category && def.match(e.payload));
      if (hasMatch) bad.push({ day, anchor: endOfDayIso(day) });
      else if (dayEvents.length >= PRESENCE_GOOD_MIN_EVENTS)
        good.push({ day, anchor: endOfDayIso(day) });
      else unknownDays.push(day);
    }
  }

  // 원인 후보(데이터에서 자동 추출). 창을 씌워 그룹별 등장 일수를 센다.
  const inputFactors = extractInputFactors(events, options);
  const windowOf = (anchor: string) =>
    events.filter((e) => withinLookback(e.occurred_at, anchor, def.lookbackHours));

  // 각 날의 창 이벤트를 미리 계산(factor 마다 재계산 방지).
  const goodWindows = good.map((d) => windowOf(d.anchor));
  const badWindows = bad.map((d) => windowOf(d.anchor));

  const factors: FactorComparison[] = inputFactors.map((f) => {
    const goodCount = goodWindows.filter((w) => f.testDay(w)).length;
    const badCount = badWindows.filter((w) => f.testDay(w)).length;
    const goodRate = good.length > 0 ? goodCount / good.length : 0;
    const badRate = bad.length > 0 ? badCount / bad.length : 0;
    return {
      id: f.id,
      label: f.label,
      goodCount,
      goodTotal: good.length,
      badCount,
      badTotal: bad.length,
      difference: goodRate - badRate,
    };
  });

  const classified: ClassifiedDay[] = [
    ...good.map((d) => ({ date: d.day, group: "good" as const, anchor: d.anchor })),
    ...bad.map((d) => ({ date: d.day, group: "bad" as const, anchor: d.anchor })),
  ];

  return {
    goodDays: good.map((d) => d.day),
    badDays: bad.map((d) => d.day),
    unknownDays,
    classified,
    factors,
    enoughData: good.length >= MIN_SAMPLES && bad.length >= MIN_SAMPLES,
    minSamplesNeeded: MIN_SAMPLES,
  };
}
