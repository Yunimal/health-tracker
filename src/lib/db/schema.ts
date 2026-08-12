/**
 * DB 행 타입. supabase/migrations/0001_init.sql 및 기획서 §5 와 1:1 로 대응한다.
 *
 * 시간 값(timestamptz)은 애플리케이션 경계에서 ISO8601 문자열로 다룬다.
 */

// ── 공통 enum (SQL CHECK 제약과 동일) ──────────────────────────────────────
export type Source = "voice" | "text";
export type Category = "food" | "mood" | "sleep" | "energy" | "menstrual" | "bowel" | "medication";
export type OccurredAtPrecision = "exact" | "hour" | "part_of_day" | "date";
export type HypothesisStatus = "open" | "supported" | "not_supported" | "dismissed";

// ── 카테고리별 payload (기획서 §5.3) ────────────────────────────────────────
// food
export type FoodKind = "food" | "drink" | "skipped_meal";
export type MealType = "breakfast" | "lunch" | "dinner" | "snack";

export interface FoodPayload {
  // 결식(skipped_meal)이면 name/name_raw/amount_* 는 모두 null 이다. (RULES R11/R12)
  name: string | null;
  name_raw: string | null;
  kind: FoodKind;
  meal_type: MealType | null;
  amount_text: string | null; // 원문 보존. 양 미언급이면 null (R12)
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

// menstrual — 관찰된 주기 사실만. (RULES R14)
export type MenstrualKind = "start" | "end" | "ongoing";
export type MenstrualFlow = "spotting" | "light" | "normal" | "heavy";
export type MenstrualPain = 1 | 2 | 3 | 4 | 5;

export interface MenstrualPayload {
  kind: MenstrualKind;
  cycle_day: number | null;
  flow: MenstrualFlow | null;
  pain: MenstrualPain | null;
  note: string | null;
}

// bowel — 배변 활동. (RULES R15)
export type BristolScale = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface BowelPayload {
  bristol: BristolScale | null;
  count: number | null;
  note: string | null;
}

// medication — 약·영양제. (RULES R16)
export type MedicationKind = "taken" | "skipped" | "dose_change";

export interface MedicationPayload {
  kind: MedicationKind;
  name: string;
  dose_text: string | null;
  dose_value: number | null;
  dose_unit: string | null;
  dose_from: string | null; // dose_change 일 때만
  dose_to: string | null; // dose_change 일 때만
  note: string | null;
}

export type EventPayload =
  | FoodPayload
  | MoodPayload
  | SleepPayload
  | EnergyPayload
  | MenstrualPayload
  | BowelPayload
  | MedicationPayload;

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
  hidden_at: string | null; // 소프트 삭제(숨김) 시각. null 이면 보임. (0004)
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
export interface MenstrualEvent extends EventBase {
  category: "menstrual";
  payload: MenstrualPayload;
}
export interface BowelEvent extends EventBase {
  category: "bowel";
  payload: BowelPayload;
}
export interface MedicationEvent extends EventBase {
  category: "medication";
  payload: MedicationPayload;
}

export type Event =
  FoodEvent | MoodEvent | SleepEvent | EnergyEvent | MenstrualEvent | BowelEvent | MedicationEvent;

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

// ── unparsed_fragments ─────────────────────────────────────────────────────
// 4개 카테고리로 담지 못한 건강 신호 원문. events 와 같은 생명주기의 파생 데이터. (RULES R2)
export interface UnparsedFragment {
  id: string;
  raw_entry_id: string;
  user_id: string;
  text: string;
  created_at: string;
}

/**
 * 가족 구성원(다중 사용자). ingest_token 으로 사용자를 식별한다. (0006_multi_user)
 * ⚠️ 진짜 보안 경계가 아니다 — 토큰을 아는 사람은 그 사용자의 기록을 볼 수 있다. (CLAUDE.md)
 */
export interface AppUser {
  id: string;
  label: string;
  ingest_token: string;
  created_at: string;
}
