import type { Category } from "@/lib/db/schema";

/** UI 표시용 순수 헬퍼. 클라이언트/서버 양쪽에서 쓰므로 서버 전용 import 금지. */

export const CATEGORY_LABEL: Record<Category, string> = {
  food: "식사",
  mood: "기분",
  sleep: "수면",
  energy: "기력",
  menstrual: "생리",
  bowel: "배변",
  medication: "약",
};

/** 한글 라벨과 함께 쓰는 아이콘. 영어 코드명은 화면에 노출하지 않는다. */
export const CATEGORY_ICON: Record<Category, string> = {
  food: "🍽",
  mood: "🙂",
  sleep: "🌙",
  energy: "⚡",
  menstrual: "🩸",
  bowel: "🚽",
  medication: "💊",
};

const SOURCE_LABEL: Record<string, string> = { voice: "음성", text: "텍스트" };
export const sourceLabel = (s: string): string => SOURCE_LABEL[s] ?? s;

const str = (p: Record<string, unknown>, k: string): string | undefined =>
  typeof p[k] === "string" && (p[k] as string).trim() !== "" ? (p[k] as string) : undefined;
const num = (p: Record<string, unknown>, k: string): number | undefined =>
  typeof p[k] === "number" ? (p[k] as number) : undefined;

// ── 숫자 척도 → 말 (화면에는 숫자를 쓰지 않는다) ──────────────────────────────
const word = (map: Record<number, string>, key: number | undefined, fallback = ""): string =>
  key != null ? (map[key] ?? fallback) : fallback;

const SLEEP_QUALITY: Record<number, string> = {
  1: "매우 나쁨",
  2: "나쁨",
  3: "보통",
  4: "좋음",
  5: "매우 좋음",
};
const ENERGY_LEVEL: Record<number, string> = {
  1: "탈진",
  2: "많이 처짐",
  3: "보통",
  4: "활기참",
  5: "활력 넘침",
};
const BRISTOL: Record<number, string> = {
  1: "매우 딱딱",
  2: "딱딱",
  3: "약간 딱딱",
  4: "보통 형태",
  5: "약간 무름",
  6: "무름",
  7: "물 같음",
};
const MENSTRUAL_FLOW: Record<string, string> = {
  spotting: "약간",
  light: "적음",
  normal: "보통",
  heavy: "많음",
};
const MENSTRUAL_PAIN: Record<number, string> = {
  1: "약간",
  2: "약간",
  3: "있음",
  4: "심함",
  5: "매우 심함",
};
const MEAL_TYPE: Record<string, string> = {
  breakfast: "아침",
  lunch: "점심",
  dinner: "저녁",
  snack: "간식",
};

// ── 시각 ──────────────────────────────────────────────────────────────────────
/** ISO(대개 UTC)를 KST 벽시계 Date 로. getUTC* 로 읽으면 KST 벽시계 값이 나온다. */
const toKst = (iso: string): Date => new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
const pad2 = (n: number): string => String(n).padStart(2, "0");

/** 하루 중 시간대를 말로. (part_of_day precision 표시에 쓴다) */
function partOfDay(hour: number): string {
  if (hour < 6) return "새벽";
  if (hour < 11) return "아침";
  if (hour < 14) return "점심";
  if (hour < 18) return "오후";
  if (hour < 22) return "저녁";
  return "밤";
}

/** "오전 9:00" 형태의 정확한 시각. */
function clockTime(d: Date): string {
  const h = d.getUTCHours();
  const ampm = h < 12 ? "오전" : "오후";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${ampm} ${h12}:${pad2(d.getUTCMinutes())}`;
}

/** 오늘/어제/내일 또는 "8월 3일". (KST 기준) */
export function relativeDay(iso: string): string {
  const d = toKst(iso);
  const now = toKst(new Date().toISOString());
  const dayMs = 24 * 60 * 60 * 1000;
  const day = (x: Date) => Math.floor(x.getTime() / dayMs);
  const diff = day(d) - day(now);
  if (diff === 0) return "오늘";
  if (diff === -1) return "어제";
  if (diff === 1) return "내일";
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`;
}

/** ISO 시각(대개 UTC)을 KST "YYYY-MM-DD HH:mm" 로. (편집창 등 정밀 표시용) */
export function toKstWallClock(iso: string): string {
  return toKst(iso).toISOString().slice(0, 16).replace("T", " ");
}

/**
 * 이벤트 발생 시각을 사람 말로. precision 이 exact 가 아니면 "쯤"을 붙여 추정임을 드러낸다.
 * - exact → "오전 9:00"  · hour → "오전 9시쯤"  · part_of_day → "점심쯤"  · date → "어제"
 */
export function formatWhen(iso: string, precision: string): string {
  const d = toKst(iso);
  const h = d.getUTCHours();
  switch (precision) {
    case "exact":
      return clockTime(d);
    case "hour": {
      const ampm = h < 12 ? "오전" : "오후";
      const h12 = h % 12 === 0 ? 12 : h % 12;
      return `${ampm} ${h12}시쯤`;
    }
    case "part_of_day":
      return `${partOfDay(h)}쯤`;
    case "date":
      return relativeDay(iso);
    default:
      return `${partOfDay(h)}쯤`;
  }
}

/** 원문 카드 머리말: "오늘 오전 9:00" 같은 친근한 날짜+시각. */
export function formatDayTime(iso: string): string {
  return `${relativeDay(iso)} ${clockTime(toKst(iso))}`;
}

// ── 이벤트 한 줄 요약 (날것 필드 대신 자연스러운 문장) ─────────────────────────
/** 손으로 교정돼 필드가 섞여 있어도 방어적으로 읽는다. 숫자 척도는 말로 푼다. */
export function summarizeEvent(category: Category, payload: Record<string, unknown>): string {
  const p = payload;
  switch (category) {
    case "food": {
      if (str(p, "kind") === "skipped_meal") {
        const meal = MEAL_TYPE[str(p, "meal_type") ?? ""];
        return meal ? `${meal} 거름` : "식사 거름";
      }
      const name = str(p, "name") ?? "무언가";
      const amountText = str(p, "amount_text");
      const amountValue = num(p, "amount_value");
      const unit = str(p, "amount_unit") ?? "";
      let s = name;
      if (amountText) s += ` ${amountText}`;
      else if (amountValue != null) s += ` ${amountValue}${unit}`;
      const meal = MEAL_TYPE[str(p, "meal_type") ?? ""];
      if (meal) s += ` · ${meal}`;
      const ratio = num(p, "completion_ratio");
      if (ratio != null && ratio < 1) s += " · 다 먹지 못함";
      return s;
    }
    case "mood": {
      const label = str(p, "label") ?? "기분";
      const note = str(p, "note");
      return note ? `${label} · ${note}` : label;
    }
    case "sleep": {
      const parts: string[] = [];
      const q = word(SLEEP_QUALITY, num(p, "quality"));
      if (q) parts.push(`수면 질 ${q}`);
      const inter = num(p, "interruptions");
      if (inter != null && inter > 0) parts.push(`${inter}번 깸`);
      const note = str(p, "note");
      if (note) parts.push(note);
      return parts.length ? parts.join(" · ") : "수면 기록";
    }
    case "energy": {
      const level = word(ENERGY_LEVEL, num(p, "level"), "기력 기록");
      const note = str(p, "note");
      return note ? `${level} · ${note}` : level;
    }
    case "menstrual": {
      const parts: string[] = [];
      const kind = str(p, "kind");
      if (kind === "start") parts.push("생리 시작");
      else if (kind === "end") parts.push("생리 종료");
      const cycleDay = num(p, "cycle_day");
      if (cycleDay != null) parts.push(`${cycleDay}일차`);
      const flow = MENSTRUAL_FLOW[str(p, "flow") ?? ""];
      if (flow) parts.push(`양 ${flow}`);
      const pain = word(MENSTRUAL_PAIN, num(p, "pain"));
      if (pain) parts.push(`통증 ${pain}`);
      const note = str(p, "note");
      if (note) parts.push(note);
      return parts.length ? parts.join(" · ") : "생리";
    }
    case "bowel": {
      const parts: string[] = [];
      const form = word(BRISTOL, num(p, "bristol"));
      if (form) parts.push(form);
      const count = num(p, "count");
      if (count != null) parts.push(`${count}회`);
      const note = str(p, "note");
      if (note) parts.push(note);
      return parts.length ? parts.join(" · ") : "배변";
    }
    case "medication": {
      const name = str(p, "name") ?? "약";
      const kind = str(p, "kind") ?? "taken";
      if (kind === "skipped") return `${name} 거름`;
      if (kind === "dose_change") {
        const from = str(p, "dose_from");
        const to = str(p, "dose_to");
        return from || to ? `${name} 용량 변경 (${from ?? "?"}→${to ?? "?"})` : `${name} 용량 변경`;
      }
      const dose = str(p, "dose_text");
      const note = str(p, "note");
      let s = `${name} 복용`;
      if (dose) s += ` · ${dose}`;
      if (note) s += ` · ${note}`;
      return s;
    }
  }
}

// ── "확인 필요" 사유 (confidence 감점 사유를 그대로 문장으로) ──────────────────
/**
 * needs_review 인 이벤트가 왜 노란지 한 줄로 설명한다. (confidence.ts R6 의 감점 사유)
 * amount/precision 은 저장된 값에서 직접 읽고, 범위(R7) 감점은 저장된 confidence 와의
 * 잔차로 추정한다(범위 여부는 별도로 저장되지 않으므로).
 */
export function reviewReasons(event: {
  category: Category;
  payload: Record<string, unknown>;
  occurred_at_precision: string;
  confidence: number;
}): string[] {
  const reasons: string[] = [];
  let known = 0;

  const kind = str(event.payload, "kind");
  const isFoodOrDrink = event.category === "food" && (kind === "food" || kind === "drink");
  if (isFoodOrDrink && num(event.payload, "amount_value") == null) {
    reasons.push("먹은 양이 명확하지 않음");
    known += 30;
  }
  if (event.occurred_at_precision !== "exact") {
    reasons.push("시각이 정확하지 않음");
    known += 20;
  }
  // 위 감점만으로 설명되지 않는 잔차가 있으면 범위 표현을 낮은 쪽으로 추정한 것이다.
  const stored = Math.round(Number(event.confidence) * 100);
  if (100 - known - stored >= 15 && stored > 30) {
    reasons.push("범위로 말해 낮은 쪽으로 추정");
  }
  return reasons;
}
