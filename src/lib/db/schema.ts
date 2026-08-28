/**
 * DB 행 타입. supabase/migrations/0001_init.sql 및 기획서 §5 와 1:1 로 대응한다.
 *
 * 시간 값(timestamptz)은 애플리케이션 경계에서 ISO8601 문자열로 다룬다.
 */

// ── 공통 enum (SQL CHECK 제약과 동일) ──────────────────────────────────────
export type Source = "voice" | "text";
export type Category =
  | "food"
  | "mood"
  | "sleep"
  | "energy"
  | "menstrual"
  | "bowel"
  | "medication"
  | "activity"
  | "appetite"
  | "digestion"
  | "body_condition"
  | "body_care"
  | "focus"
  | "environment";
export type OccurredAtPrecision = "exact" | "hour" | "part_of_day" | "date";
export type HypothesisStatus = "open" | "supported" | "not_supported" | "dismissed";

// ── 카테고리별 payload (기획서 §5.3) ────────────────────────────────────────
// food
export type FoodKind = "food" | "drink" | "skipped_meal";
export type MealType = "breakfast" | "lunch" | "dinner" | "snack";
// 섭취 동기(왜 먹었나). 발화에 진술된 경우만. 추측하지 않는다. (RULES R19)
export type FoodReason =
  "hunger" | "boredom" | "craving" | "social" | "routine" | "emotion";

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
  // 섭취 동기 (R19). 발화에 이유가 없으면 둘 다 null. 상황으로 짐작하지 않는다.
  // 화면에는 reason(enum)을 노출하지 않고 reason_text 원문만 보여준다.
  reason_text: string | null; // 이유를 가장 직접적으로 진술한 원문 1구절, 없으면 null
  reason: FoodReason | null;
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

// activity — 운동·신체활동. (RULES R18)
export interface ActivityPayload {
  name: string; // 발화에 쓰인 단어 그대로. "산책"을 "걷기"로 바꾸지 않는다.
  duration_min: number | null; // "30분" → 30
  distance_km: number | null; // "5km" → 5
  intensity_text: string | null; // 원문 표현 그대로. 숫자화하지 않는다.
  note: string | null;
}

// appetite — 식욕·공복감. (RULES R20) 강도는 숫자화하지 않고 원문 그대로. 판단 라벨 금지.
export type AppetiteKind = "hunger" | "fullness" | "craving" | "no_appetite";

export interface AppetitePayload {
  kind: AppetiteKind;
  intensity_text: string | null; // "너무 배고파", "살짝 출출". 숫자화하지 않는다.
  controllable_text: string | null; // "참을 만해", "못 참겠어". 판단 라벨로 바꾸지 않는다.
  note: string | null;
}

// digestion — 소화 감각. (RULES R21) 배변 활동(bowel)과 구분. 강도는 원문 그대로.
export type DigestionKind = "gas" | "bloating" | "heartburn" | "pain" | "nausea" | "other";

export interface DigestionPayload {
  kind: DigestionKind;
  intensity_text: string | null;
  note: string | null;
}

// body_condition / body_care — 신체 부위의 상태(관찰)와 관리(행위). (RULES R23/R24)
// part enum 은 두 카테고리가 하나의 목록을 공유한다. 개수를 늘리는 대신 부위를 필드로 뺀다.
export type BodyPart =
  | "scalp" // 두피
  | "hair" // 모발
  | "skin" // 피부
  | "vaginal" // 질
  | "nail" // 손발톱
  | "oral" // 구강
  | "eye" // 눈
  | "armpit" // 겨드랑이
  | "foot" // 발
  | "elbow" // 팔꿈치
  | "groin" // 사타구니
  | "libido" // 성욕
  | "other";

// body_condition — 상태(관찰). 방향(issue/improvement)을 판정하는 필드를 두지 않는다:
// 좋고 나쁨은 사람·시기에 따라 다르고, 파서가 판정하면 판단 라벨이 된다. (CLAUDE.md 원칙 6)
export interface BodyConditionPayload {
  part: BodyPart;
  description_text: string; // 상태를 말한 그대로. "가렵다", "뒤집어졌다", "매끈해졌다"
  // 지속 상태의 발단 원문. "어제부터", "요즘". 발단 날짜를 숫자로 계산하지 않는다. (R23 보강)
  // occurred_at 은 발단이 아니라 관찰 시점(recorded_at)으로 둔다.
  since_text: string | null;
  self_rating: number | null; // 사용자가 명시적으로 말한 점수만. 서술로 지어내지 않는다.
  rating_scale: number | null; // 그 점수의 만점. "5점 중 2점" → 5
  note: string | null;
}

// body_care — 관리 행위(내가 한 것). 상태(R23)와 섞지 않는다.
export interface BodyCarePayload {
  part: BodyPart;
  action_text: string; // 관리 행위를 말한 그대로. "제모함", "각질 제거", "미백크림 발랐어"
  product_text: string | null; // 사용한 제품 원문. 없으면 null
  note: string | null;
}

// focus — 집중 상태(결과 변수). energy 와 다른 축이다. level 수치화는 R25(1~5).
export type FocusLevel = 1 | 2 | 3 | 4 | 5;
export interface FocusPayload {
  level: FocusLevel; // 1 아예 안 됨 ~ 5 몰입
  note: string | null;
}

// environment — 환경 요인(원인 후보). 상태도 행위도 아닌 맥락. (R26)
export type EnvironmentKind = "sleep" | "work" | "light_exposure" | "other";
export interface EnvironmentPayload {
  kind: EnvironmentKind;
  description_text: string; // "에어컨 켜고 잤어", "카페에서 작업했어"
  note: string | null;
}

export type EventPayload =
  | FoodPayload
  | MoodPayload
  | SleepPayload
  | EnergyPayload
  | MenstrualPayload
  | BowelPayload
  | MedicationPayload
  | ActivityPayload
  | AppetitePayload
  | DigestionPayload
  | BodyConditionPayload
  | BodyCarePayload
  | FocusPayload
  | EnvironmentPayload;

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
export interface ActivityEvent extends EventBase {
  category: "activity";
  payload: ActivityPayload;
}
export interface AppetiteEvent extends EventBase {
  category: "appetite";
  payload: AppetitePayload;
}
export interface DigestionEvent extends EventBase {
  category: "digestion";
  payload: DigestionPayload;
}
export interface BodyConditionEvent extends EventBase {
  category: "body_condition";
  payload: BodyConditionPayload;
}
export interface BodyCareEvent extends EventBase {
  category: "body_care";
  payload: BodyCarePayload;
}
export interface FocusEvent extends EventBase {
  category: "focus";
  payload: FocusPayload;
}
export interface EnvironmentEvent extends EventBase {
  category: "environment";
  payload: EnvironmentPayload;
}

export type Event =
  | FoodEvent
  | MoodEvent
  | SleepEvent
  | EnergyEvent
  | MenstrualEvent
  | BowelEvent
  | MedicationEvent
  | ActivityEvent
  | AppetiteEvent
  | DigestionEvent
  | BodyConditionEvent
  | BodyCareEvent
  | FocusEvent
  | EnvironmentEvent;

// ── hypotheses ─────────────────────────────────────────────────────────────
export interface Hypothesis {
  id: string;
  raw_entry_id: string | null; // 최초 생성 원문(origin). 카운팅은 hypothesis_mentions 가 담당. (0008)
  user_id: string;
  statement: string; // 최초 표현(유지)
  recent_statement: string | null; // 가장 최근 표현 (0008)
  cause_hint: string | null;
  effect_hint: string | null;
  mention_count: number; // 이 의심을 표현한 서로 다른 raw_entry 수 = mention 행 수 (0008)
  status: HypothesisStatus;
  created_at: string;
}

/**
 * 가설 mention. 같은 의심(hypothesis)을 표현한 raw_entry 를 링크한다. (0008)
 * events 와 같은 생명주기의 파생 데이터(재파싱 시 삭제·재생성).
 * unique(hypothesis_id, raw_entry_id) — 한 원문은 한 의심에 한 번만.
 */
export interface HypothesisMention {
  id: string;
  hypothesis_id: string;
  raw_entry_id: string;
  user_id: string;
  statement: string | null;
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

// ── reflections ────────────────────────────────────────────────────────────
/** 생각·고민·자기관찰 문장. 사건이 아니라 생각이라 events 가 아니다. 파생 데이터(재파싱 시 재생성). (0012) */
export interface Reflection {
  id: string;
  raw_entry_id: string;
  user_id: string;
  text: string;
  created_at: string;
}

/**
 * 성찰에 대한 응답("같이 생각해보기"). **파생 데이터가 아니다** — 재파싱해도 지우지 않는다.
 * reflections 는 재생성되므로 (raw_entry_id, reflection_text)로 느슨히 연결한다. (0012)
 */
export interface ReflectionReply {
  id: string;
  raw_entry_id: string;
  user_id: string;
  reflection_text: string;
  reply: string;
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
