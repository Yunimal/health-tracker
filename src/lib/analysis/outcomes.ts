/**
 * 결과(outcome) 레지스트리 — "결과 ← 원인" 축 분석의 1단계.
 *
 * 사용자의 질문은 "수면이 나빴던 날은 뭐가 달랐나" 형태다. 그 "수면이 나빴던"에 해당하는
 * 결과들을 여기 한 곳에 등록한다. 결과가 늘어나면 이 배열에 한 줄 추가하면 되고, 화면·계산
 * 코드는 그대로 둔다. (기획서 §3, docs/analysis-design.md)
 *
 * ⚠️ 여기서 정하는 것은 "무엇을 결과로 볼지"와 "어느 값이 좋고 나쁜지의 구간"뿐이다.
 *    종합 점수를 만들지 않고, 상관·유의성 판정도 하지 않는다. (CLAUDE.md 원칙 6)
 */
import type { Category } from "@/lib/db/schema";

/** 분석 함수들이 받는 최소 이벤트 형태. DashboardEvent 등과 구조적으로 호환된다. */
export interface AnalysisEvent {
  category: Category;
  occurred_at: string; // ISO8601 (+09:00 등 오프셋 포함)
  payload: Record<string, unknown>;
}

export type NumRange = [number, number];

/**
 * 화면 라벨은 판단어("좋음/나쁨")가 아니라 **관찰 사실**로 쓴다. 무엇이 좋고 나쁜지는
 * 사용자 기준이라 앱이 단정하지 않는다. goodLabel 은 compare 의 goodDays 쪽, badLabel 은
 * badDays 쪽에 대응한다. (CLAUDE.md 원칙 6)
 */
interface OutcomeLabels {
  goodLabel: string; // 예: "잘 잔 날"
  badLabel: string; // 예: "못 잔 날"
  // 나쁜 쪽을 붉게 강조하지 않고 옅은 호박색으로 절제한다(자책 도구가 되지 않게). craving 용.
  badMuted?: boolean;
}

/** 숫자 필드가 있는 결과. 값의 구간으로 좋음/나쁨을 나눈다. */
export interface ScaleOutcome extends OutcomeLabels {
  kind: "scale";
  id: string;
  label: string; // 화면 표시용 한글
  category: Category;
  valuePath: string; // payload 내 경로. 예: "quality" (점 표기 중첩도 지원)
  scale: { min: number; max: number };
  direction: "high_good" | "low_good" | "mid_good";
  // mid_good 은 양 끝이 나쁜 경우 (브리스톨 1,7 이 나쁘고 4 가 좋음)
  goodRange: NumRange;
  badRange: NumRange | NumRange[]; // mid_good 은 양쪽 구간
  lookbackHours: number; // 원인 후보를 결과 시점 기준 몇 시간 전까지 볼지
}

/** 있었나/없었나로 보는 결과. (수치가 없거나, 발생 자체가 결과인 것) */
export interface PresenceOutcome extends OutcomeLabels {
  kind: "presence";
  id: string;
  label: string;
  category: Category;
  match: (payload: unknown) => boolean; // 예: appetite.kind === "craving"
  lookbackHours: number;
}

export type OutcomeDef = ScaleOutcome | PresenceOutcome;

/** payload.kind 를 안전하게 읽는다(비객체 방어). */
function payloadKind(p: unknown): unknown {
  return p && typeof p === "object" ? (p as Record<string, unknown>).kind : undefined;
}

/**
 * 초기 등록 결과.
 *
 * lookbackHours 근거:
 *  - 결과가 관찰되기 "전"의 입력을 어디까지 원인 후보로 볼지를 정한다. 인과를 증명하는 값이
 *    아니라, 나란히 보여줄 창(window)의 크기다. 넓게 잡으면 무관한 것이 섞이고, 좁게 잡으면
 *    전날 입력을 놓친다.
 */
export const OUTCOMES: OutcomeDef[] = [
  {
    kind: "scale",
    id: "sleep_quality",
    label: "수면의 질",
    goodLabel: "잘 잔 날",
    badLabel: "못 잔 날",
    category: "sleep",
    valuePath: "quality",
    scale: { min: 1, max: 5 },
    direction: "high_good",
    goodRange: [4, 5],
    badRange: [1, 2],
    // 18h: 취침 시각을 기준으로 그날 아침(카페인·운동)부터의 입력을 담기 위함.
    // 24h 면 전날 밤 취침까지 겹쳐 이중 계산되고, 12h 면 그날 오전이 빠진다.
    lookbackHours: 18,
  },
  {
    kind: "scale",
    id: "bowel",
    label: "배변 상태",
    goodLabel: "괜찮았던 날",
    badLabel: "안 좋았던 날",
    category: "bowel",
    valuePath: "bristol",
    scale: { min: 1, max: 7 },
    direction: "mid_good",
    goodRange: [3, 5],
    badRange: [
      [1, 2],
      [6, 7],
    ],
    // 36h: 배변은 전날(때로는 그 전날 저녁) 먹은 것의 영향이 크다(장 통과 시간이 하루 안팎).
    // 24h 로는 전날 아침·점심이 잘려 나가서 하루를 넘겨 36h 로 둔다.
    lookbackHours: 36,
  },
  {
    kind: "scale",
    id: "mood",
    label: "기분",
    goodLabel: "기분 좋았던 날",
    badLabel: "기분 안 좋았던 날",
    category: "mood",
    valuePath: "valence",
    scale: { min: -2, max: 2 },
    direction: "high_good",
    goodRange: [1, 2],
    badRange: [-2, -1],
    // 24h: 기분은 그날의 수면·식사·활동·사건 전반의 영향을 받으므로 하루를 본다.
    lookbackHours: 24,
  },
  {
    kind: "scale",
    id: "menstrual_pain",
    label: "생리통",
    goodLabel: "덜 아팠던 날",
    badLabel: "많이 아팠던 날",
    category: "menstrual",
    valuePath: "pain",
    scale: { min: 1, max: 5 },
    direction: "low_good",
    goodRange: [1, 2],
    badRange: [4, 5],
    // 24h: 통증이 관찰된 날 기준 전날의 활동·식사·수면과 함께 볼 수 있게 하루.
    lookbackHours: 24,
  },
  {
    kind: "scale",
    id: "focus",
    label: "집중",
    goodLabel: "집중된 날",
    badLabel: "산만했던 날",
    category: "focus",
    valuePath: "level",
    scale: { min: 1, max: 5 },
    direction: "high_good",
    goodRange: [4, 5],
    badRange: [1, 2],
    // 12h: 집중은 그날의 수면·카페인·환경 같은 가까운 입력의 영향을 받는다. 반나절 창으로 본다.
    // (energy 와 다른 축이라 별도 결과다 — R25)
    lookbackHours: 12,
  },
  {
    kind: "presence",
    id: "craving",
    label: "음식 갈망(craving)",
    // 갈망은 좋음/나쁨을 붙이지 않는다(관찰만). 붉게 칠하면 식욕을 잘못한 일처럼 보인다.
    goodLabel: "갈망 없던 날",
    badLabel: "갈망 있던 날",
    badMuted: true, // 붉은색 대신 옅은 호박색으로 절제. (CLAUDE.md 원칙 6)
    category: "appetite",
    match: (p) => payloadKind(p) === "craving",
    // 12h: 갈망은 직전 반나절의 상태(허기·스트레스·수면 부족)와 가깝게 붙는다. 하루 전체를
    // 보면 아침 입력까지 섞여 관련 없는 것이 늘어난다. 반나절로 좁힌다.
    lookbackHours: 12,
  },
  {
    kind: "presence",
    id: "digestion",
    label: "소화 불편",
    goodLabel: "괜찮았던 날",
    badLabel: "불편했던 날",
    category: "digestion",
    // digestion 이벤트는 그 자체가 소화 불편의 관찰이다(gas/bloating/pain 등). 존재 여부로 본다.
    match: () => true,
    // 24h: 소화 증상은 그날(그리고 전날 저녁) 먹은 것과 연결해 보므로 하루.
    lookbackHours: 24,
  },
];

export function getOutcome(id: string): OutcomeDef | undefined {
  return OUTCOMES.find((o) => o.id === id);
}

// ── 값 읽기 / 분류 ────────────────────────────────────────────────────────────

/** valuePath(점 표기 지원)로 payload 에서 숫자를 읽는다. 숫자가 아니면 null. */
export function readScaleValue(def: ScaleOutcome, payload: Record<string, unknown>): number | null {
  let cur: unknown = payload;
  for (const key of def.valuePath.split(".")) {
    if (cur && typeof cur === "object" && key in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[key];
    } else {
      return null;
    }
  }
  return typeof cur === "number" ? cur : null;
}

function inRange(v: number, r: NumRange): boolean {
  return v >= r[0] && v <= r[1];
}

/** badRange 는 단일 구간이거나(예: [1,2]) 구간 배열(mid_good, 예: [[1,2],[6,7]])이다. */
function inBadRange(v: number, bad: NumRange | NumRange[]): boolean {
  return Array.isArray(bad[0])
    ? (bad as NumRange[]).some((r) => inRange(v, r))
    : inRange(v, bad as NumRange);
}

/**
 * 값을 good / bad / middle 로 분류한다. good/bad 구간 어디에도 없으면 middle(중간)이며
 * 비교에서 제외된다(좋았다고도 나빴다고도 할 수 없는 날). middle 은 unknown 과 다르다 —
 * unknown 은 결과 기록 자체가 없는 날이다. (compare.ts 참고)
 */
export function classifyScaleValue(def: ScaleOutcome, value: number): "good" | "bad" | "middle" {
  if (inRange(value, def.goodRange)) return "good";
  if (inBadRange(value, def.badRange)) return "bad";
  return "middle";
}

/** ISO 시각 → KST YYYY-MM-DD. 집계 기준일. */
export function kstDateOf(iso: string): string {
  return new Date(Date.parse(iso) + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
