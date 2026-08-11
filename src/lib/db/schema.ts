/**
 * DB 행 타입. supabase/migrations/0001_init.sql 및 기획서 §5 와 1:1 로 대응한다.
 *
 * 시간 값(timestamptz)은 애플리케이션 경계에서 ISO8601 문자열로 다룬다.
 */

// ── 공통 enum (SQL CHECK 제약과 동일) ──────────────────────────────────────
export type Source = "voice" | "text";
export type Category = "food" | "mood" | "sleep" | "energy";
export type OccurredAtPrecision = "exact" | "hour" | "part_of_day" | "date";
export type HypothesisStatus = "open" | "supported" | "not_supported" | "dismissed";

// ── 카테고리별 payload (기획서 §5.3) ────────────────────────────────────────
// food
export type FoodKind = "food" | "drink" | "skipped_meal";
export type MealType = "breakfast" | "lunch" | "dinner" | "snack";

export interface FoodPayload {
  name: string;
  name_raw: string;
  kind: FoodKind;
  meal_type: MealType | null;
  amount_text: string; // 원문 보존 (필수)
  amount_value: number | null; // 추정치, 없으면 null
  amount_unit: string | null;
  completion_ratio: number | null; // "80% 정도 먹음" → 0.8
}

// mood — valence: -2(매우 부정) ~ +2(매우 긍정), arousal: 0(차분) ~ 3(각성)
export type Valence = -2 | -1 | 0 | 1 | 2;
export type Arousal = 0 | 1 | 2 | 3;

export interface MoodPayload {
  label: string;
  valence: Valence;
  arousal: Arousal;
  note: string | null;
}

// sleep — quality: 1(매우 나쁨) ~ 5(매우 좋음)
export type SleepQuality = 1 | 2 | 3 | 4 | 5;

export interface SleepPayload {
  bedtime: string | null;
  wake_time: string | null;
  quality: SleepQuality | null;
  interruptions: number | null;
  note: string | null;
}

// energy — level: 1(탈진) ~ 5(활력 충만)
export type EnergyLevel = 1 | 2 | 3 | 4 | 5;

export interface EnergyPayload {
  level: EnergyLevel;
  note: string | null;
}

export type EventPayload = FoodPayload | MoodPayload | SleepPayload | EnergyPayload;

// ── raw_entries ────────────────────────────────────────────────────────────
export interface RawEntry {
  id: string;
  user_id: string;
  recorded_at: string; // 사용자가 말한 시각
  source: Source;
  transcript: string;
  audio_path: string | null;
  parse_version: string | null;
  parsed_at: string | null;
  parse_error: string | null;
  created_at: string;
}

/** raw_entries INSERT 시 애플리케이션이 채우는 필드. 나머지는 DB 기본값. */
export interface RawEntryInsert {
  user_id: string;
  transcript: string;
  source: Source;
  recorded_at?: string;
}

// ── events (category 로 구분되는 discriminated union) ────────────────────────
interface EventBase {
  id: string;
  raw_entry_id: string;
  user_id: string;
  occurred_at: string;
  occurred_at_precision: OccurredAtPrecision;
  confidence: number;
  needs_review: boolean;
  corrected_by_user: boolean;
  created_at: string;
}

export interface FoodEvent extends EventBase {
  category: "food";
  payload: FoodPayload;
}
export interface MoodEvent extends EventBase {
  category: "mood";
  payload: MoodPayload;
}
export interface SleepEvent extends EventBase {
  category: "sleep";
  payload: SleepPayload;
}
export interface EnergyEvent extends EventBase {
  category: "energy";
  payload: EnergyPayload;
}

export type Event = FoodEvent | MoodEvent | SleepEvent | EnergyEvent;

// ── hypotheses ─────────────────────────────────────────────────────────────
export interface Hypothesis {
  id: string;
  raw_entry_id: string | null;
  user_id: string;
  statement: string;
  cause_hint: string | null;
  effect_hint: string | null;
  mention_count: number;
  status: HypothesisStatus;
  created_at: string;
}
