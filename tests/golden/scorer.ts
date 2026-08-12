/**
 * 골든 채점기 (기획서 §6.3). API 호출 없는 순수 로직 — 입력은 expected/actual 쌍.
 *
 * 4개 지표:
 *  1. 이벤트 개수 일치율 (검출 recall/precision/F1 + 미검출/과검출)
 *  2. 카테고리 정확도 (짝지어진 이벤트 중 카테고리가 맞는 비율)
 *  3. occurred_at 오차 (짝지어진 이벤트 중 ±1시간 이내 비율)
 *  4. 가설/사실 오분류 건수 ← 가장 중요한 지표
 *
 * 매칭: LLM 출력 순서에 의존하지 않는다. 같은 카테고리끼리 시각 근접도로 먼저 짝짓고
 * (1단계), 남은 것끼리 카테고리 무관하게 시각으로 짝짓는다(2단계 → 카테고리 오분류 탐지).
 * 끝까지 짝을 못 찾으면 미검출(expected만) / 과검출(actual만).
 */

export interface ScoreEvent {
  category: string;
  occurred_at: string;
}
export interface ScoreHypothesis {
  statement: string;
  cause_hint: string | null;
  effect_hint: string | null;
}
export interface ScoreSide {
  events: ScoreEvent[];
  hypotheses: ScoreHypothesis[];
}

export const MATCH_WINDOW_MIN = 180; // 이벤트 매칭 허용 창 (±3시간)
export const OCCURRED_AT_TOLERANCE_MIN = 60; // §6.3: ±1시간 이내면 통과
export const HYPOTHESIS_SIM_THRESHOLD = 0.4; // 가설 매칭 유사도 하한

// ── 유틸 ─────────────────────────────────────────────────────────────────────
function timeDiffMin(a: string, b: string): number {
  return Math.abs(Date.parse(a) - Date.parse(b)) / 60000;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[\s\p{P}]/gu, "");
}

function bigrams(s: string): Set<string> {
  const set = new Set<string>();
  if (s.length <= 1) {
    if (s) set.add(s);
    return set;
  }
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

function hypText(h: ScoreHypothesis): string {
  return normalize(`${h.statement} ${h.cause_hint ?? ""} ${h.effect_hint ?? ""}`);
}

function hypSim(a: ScoreHypothesis, b: ScoreHypothesis): number {
  return jaccard(bigrams(hypText(a)), bigrams(hypText(b)));
}

/** 임의의 파싱 결과(expected JSON 또는 actual ParseResult)를 채점 입력으로 좁힌다. */
export function toScoreSide(raw: {
  events?: { category: string; occurred_at: string }[];
  hypotheses?: { statement: string; cause_hint: string | null; effect_hint: string | null }[];
}): ScoreSide {
  return {
    events: (raw.events ?? []).map((e) => ({ category: e.category, occurred_at: e.occurred_at })),
    hypotheses: (raw.hypotheses ?? []).map((h) => ({
      statement: h.statement,
      cause_hint: h.cause_hint ?? null,
      effect_hint: h.effect_hint ?? null,
    })),
  };
}

// ── 케이스 채점 결과 ─────────────────────────────────────────────────────────
export interface CaseResult {
  name: string;
  error?: string;
  events: {
    expected: number;
    actual: number;
    matched: number;
    missed: number;
    extra: number;
    categoryCorrect: number;
    withinTolerance: number;
    missedEvents: ScoreEvent[];
    extraEvents: ScoreEvent[];
    categoryErrors: { time: string; expected: string; actual: string }[];
    timeErrors: { expected: string; actual: string; diffMin: number }[];
  };
  hypotheses: {
    expected: number;
    actual: number;
    matched: number;
    misclassifications: number; // missing + spurious
    missing: ScoreHypothesis[];
    spurious: ScoreHypothesis[];
  };
}

interface Pair {
  ei: number;
  ai: number;
  categoryMatch: boolean;
  diffMin: number;
}

function greedyMatch(
  expected: ScoreEvent[],
  actual: ScoreEvent[],
  usedE: Set<number>,
  usedA: Set<number>,
  allow: (e: ScoreEvent, a: ScoreEvent) => boolean,
): Pair[] {
  const cands: Pair[] = [];
  expected.forEach((e, ei) => {
    if (usedE.has(ei)) return;
    actual.forEach((a, ai) => {
      if (usedA.has(ai)) return;
      if (!allow(e, a)) return;
      cands.push({
        ei,
        ai,
        categoryMatch: e.category === a.category,
        diffMin: timeDiffMin(e.occurred_at, a.occurred_at),
      });
    });
  });
  cands.sort((x, y) => x.diffMin - y.diffMin);
  const pairs: Pair[] = [];
  for (const c of cands) {
    if (usedE.has(c.ei) || usedA.has(c.ai)) continue;
    usedE.add(c.ei);
    usedA.add(c.ai);
    pairs.push(c);
  }
  return pairs;
}

export function scoreCase(
  name: string,
  expected: ScoreSide,
  actual: ScoreSide,
  error?: string,
): CaseResult {
  const usedE = new Set<number>();
  const usedA = new Set<number>();
  const within = (e: ScoreEvent, a: ScoreEvent) =>
    timeDiffMin(e.occurred_at, a.occurred_at) <= MATCH_WINDOW_MIN;

  // 1단계: 같은 카테고리끼리 시각 근접 매칭. 2단계: 남은 것끼리 카테고리 무관 매칭.
  const phaseA = greedyMatch(
    expected.events,
    actual.events,
    usedE,
    usedA,
    (e, a) => e.category === a.category && within(e, a),
  );
  const phaseB = greedyMatch(expected.events, actual.events, usedE, usedA, within);
  const pairs = [...phaseA, ...phaseB];

  let categoryCorrect = 0;
  let withinTolerance = 0;
  const categoryErrors: CaseResult["events"]["categoryErrors"] = [];
  const timeErrors: CaseResult["events"]["timeErrors"] = [];
  for (const p of pairs) {
    const e = expected.events[p.ei]!;
    const a = actual.events[p.ai]!;
    if (p.categoryMatch) categoryCorrect++;
    else categoryErrors.push({ time: e.occurred_at, expected: e.category, actual: a.category });
    if (p.diffMin <= OCCURRED_AT_TOLERANCE_MIN) withinTolerance++;
    else timeErrors.push({ expected: e.occurred_at, actual: a.occurred_at, diffMin: p.diffMin });
  }

  const missedEvents = expected.events.filter((_, i) => !usedE.has(i));
  const extraEvents = actual.events.filter((_, i) => !usedA.has(i));

  // 가설 매칭: 유사도 최대쌍부터 greedy. 짝 못 찾은 expected=missing, actual=spurious.
  const usedEH = new Set<number>();
  const usedAH = new Set<number>();
  const simCands: { ei: number; ai: number; sim: number }[] = [];
  expected.hypotheses.forEach((eh, ei) => {
    actual.hypotheses.forEach((ah, ai) => {
      const sim = hypSim(eh, ah);
      if (sim >= HYPOTHESIS_SIM_THRESHOLD) simCands.push({ ei, ai, sim });
    });
  });
  simCands.sort((x, y) => y.sim - x.sim);
  let hypMatched = 0;
  for (const c of simCands) {
    if (usedEH.has(c.ei) || usedAH.has(c.ai)) continue;
    usedEH.add(c.ei);
    usedAH.add(c.ai);
    hypMatched++;
  }
  const missing = expected.hypotheses.filter((_, i) => !usedEH.has(i));
  const spurious = actual.hypotheses.filter((_, i) => !usedAH.has(i));

  return {
    name,
    error,
    events: {
      expected: expected.events.length,
      actual: actual.events.length,
      matched: pairs.length,
      missed: missedEvents.length,
      extra: extraEvents.length,
      categoryCorrect,
      withinTolerance,
      missedEvents,
      extraEvents,
      categoryErrors,
      timeErrors,
    },
    hypotheses: {
      expected: expected.hypotheses.length,
      actual: actual.hypotheses.length,
      matched: hypMatched,
      misclassifications: missing.length + spurious.length,
      missing,
      spurious,
    },
  };
}

// ── 스위트 집계 ──────────────────────────────────────────────────────────────
export interface SuiteTotals {
  events_expected: number;
  events_actual: number;
  events_matched: number;
  events_missed: number;
  events_extra: number;
  detection_recall: number;
  detection_precision: number;
  detection_f1: number;
  category_correct: number;
  category_accuracy: number;
  occurred_at_within_tol: number;
  occurred_at_pass_rate: number;
  hypotheses_expected: number;
  hypotheses_actual: number;
  hypotheses_matched: number;
  hypothesis_misclassifications: number;
}

export interface SuiteReport {
  parse_version: string;
  model: string;
  generated_at: string;
  case_count: number;
  totals: SuiteTotals;
  cases: CaseResult[];
}

function ratio(n: number, d: number): number {
  return d === 0 ? 1 : n / d;
}

export function scoreSuite(
  cases: CaseResult[],
  meta: { parse_version: string; model: string; generated_at: string },
): SuiteReport {
  const t: SuiteTotals = {
    events_expected: 0,
    events_actual: 0,
    events_matched: 0,
    events_missed: 0,
    events_extra: 0,
    detection_recall: 0,
    detection_precision: 0,
    detection_f1: 0,
    category_correct: 0,
    category_accuracy: 0,
    occurred_at_within_tol: 0,
    occurred_at_pass_rate: 0,
    hypotheses_expected: 0,
    hypotheses_actual: 0,
    hypotheses_matched: 0,
    hypothesis_misclassifications: 0,
  };
  for (const c of cases) {
    t.events_expected += c.events.expected;
    t.events_actual += c.events.actual;
    t.events_matched += c.events.matched;
    t.events_missed += c.events.missed;
    t.events_extra += c.events.extra;
    t.category_correct += c.events.categoryCorrect;
    t.occurred_at_within_tol += c.events.withinTolerance;
    t.hypotheses_expected += c.hypotheses.expected;
    t.hypotheses_actual += c.hypotheses.actual;
    t.hypotheses_matched += c.hypotheses.matched;
    t.hypothesis_misclassifications += c.hypotheses.misclassifications;
  }
  t.detection_recall = ratio(t.events_matched, t.events_expected);
  t.detection_precision = ratio(t.events_matched, t.events_actual);
  const pr = t.detection_precision + t.detection_recall;
  t.detection_f1 = pr === 0 ? 0 : (2 * t.detection_precision * t.detection_recall) / pr;
  t.category_accuracy = ratio(t.category_correct, t.events_matched);
  t.occurred_at_pass_rate = ratio(t.occurred_at_within_tol, t.events_matched);

  return { ...meta, case_count: cases.length, totals: t, cases };
}

// ── 사람이 읽는 표 ───────────────────────────────────────────────────────────
function pct(n: number): string {
  return `${(n * 100).toFixed(0)}%`.padStart(4);
}
function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

export function renderTable(report: SuiteReport): string {
  const lines: string[] = [];
  lines.push(`골든 채점 — parse_version=${report.parse_version}  model=${report.model}`);
  lines.push(`생성: ${report.generated_at}   케이스: ${report.case_count}`);
  lines.push("");
  lines.push(
    pad("case", 10) +
      "| " +
      pad("events (exp→act ✓m ✗miss +extra)", 34) +
      "| " +
      pad("cat", 5) +
      "| " +
      pad("time±1h", 8) +
      "| hyp",
  );
  lines.push("-".repeat(74));
  for (const c of report.cases) {
    const ev = c.events;
    const evStr = `${ev.expected}→${ev.actual}  ✓${ev.matched} ✗${ev.missed} +${ev.extra}`;
    const cat = ev.matched === 0 ? "  – " : pct(ev.categoryCorrect / ev.matched);
    const time = ev.matched === 0 ? "   – " : pct(ev.withinTolerance / ev.matched);
    const hyp =
      c.hypotheses.misclassifications > 0 ? `mis${c.hypotheses.misclassifications}` : "ok";
    const flag = c.error ? " [ERROR]" : "";
    lines.push(
      pad(c.name, 10) +
        "| " +
        pad(evStr, 34) +
        "| " +
        pad(cat, 5) +
        "| " +
        pad(time, 8) +
        "| " +
        hyp +
        flag,
    );
  }
  lines.push("-".repeat(74));
  const t = report.totals;
  lines.push("[지표 요약]");
  lines.push(
    `  이벤트 검출  : recall ${pct(t.detection_recall)}  precision ${pct(t.detection_precision)}  F1 ${pct(t.detection_f1)}` +
      `   (matched ${t.events_matched}/${t.events_expected}, 미검출 ${t.events_missed}, 과검출 ${t.events_extra})`,
  );
  lines.push(
    `  카테고리 정확도 : ${pct(t.category_accuracy)}  (${t.category_correct}/${t.events_matched})`,
  );
  lines.push(
    `  occurred_at ±1h : ${pct(t.occurred_at_pass_rate)}  (${t.occurred_at_within_tol}/${t.events_matched})`,
  );
  lines.push(
    `  가설/사실 오분류 : ${t.hypothesis_misclassifications} 건  ` +
      `(가설 matched ${t.hypotheses_matched}/${t.hypotheses_expected}, actual ${t.hypotheses_actual})  ← 가장 중요`,
  );
  return lines.join("\n");
}
