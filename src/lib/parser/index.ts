import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { env } from "@/lib/env";
import { computeConfidence } from "./confidence";
import { PROMPT_V1 } from "./prompts/v1";
import { PROMPT_V2 } from "./prompts/v2";
import { PROMPT_V3 } from "./prompts/v3";
import { PROMPT_V4 } from "./prompts/v4";
import { PROMPT_V5 } from "./prompts/v5";
import { PROMPT_V6 } from "./prompts/v6";
import { PROMPT_V7 } from "./prompts/v7";
import { PROMPT_V8 } from "./prompts/v8";
import { PROMPT_V9 } from "./prompts/v9";
import type { Category, OccurredAtPrecision } from "@/lib/db/schema";

/**
 * LLM 파싱 파이프라인. (기획서 §6, tests/golden/RULES.md)
 *
 * 설계: LLM 은 confidence/needs_review 를 출력하지 않는다. 판정에 필요한 사실만
 * 뽑고(payload + is_range_expression), confidence 는 computeConfidence 가 R6 로 계산한다.
 */

/** 파싱 모델은 env(PARSE_MODEL)로 오버라이드. 기본값은 env.parseModel() 참고. */

/** 프롬프트 파일명과 동기화한다. 프롬프트를 고치면 prompts/vN.ts 를 새로 만들고 이 값을 올린다. */
export const PARSE_VERSION = "v9";

// 출력 한도. 사고(thinking)는 꺼도(아래 callModel) 이벤트가 많은 원문은 출력이 길어진다 —
// 카테고리 10개 + payload 필드 확장으로 이벤트당 출력이 늘어, 13건짜리 원문에서 11,779자가
// 8192 토큰을 넘겼다. 16384 로 둔다. 출력 토큰은 실제 생성분만 과금되므로 한도 상향에 비용 부담 없음.
const MAX_TOKENS = 16384;

// 실제 Anthropic API 호출 횟수(재시도 포함). 골든 채점에서 호출 수를 콘솔에 찍는다.
let apiCallCount = 0;
export function getApiCallCount(): number {
  return apiCallCount;
}
export function resetApiCallCount(): void {
  apiCallCount = 0;
}

// 누적 토큰 사용량(모든 호출 합산). 골든 채점에서 평균을 콘솔에 찍는다.
let totalInputTokens = 0;
let totalOutputTokens = 0;
export function getTokenTotals(): { inputTokens: number; outputTokens: number } {
  return { inputTokens: totalInputTokens, outputTokens: totalOutputTokens };
}
export function resetTokenTotals(): void {
  totalInputTokens = 0;
  totalOutputTokens = 0;
}

// ── LLM 출력 스키마 (zod). 범위 제약을 런타임에 강제한다. ────────────────────
const precisionSchema = z.enum(["exact", "hour", "part_of_day", "date"]);

const foodPayloadSchema = z.object({
  name: z.string().nullable(),
  name_raw: z.string().nullable(),
  kind: z.enum(["food", "drink", "skipped_meal"]),
  meal_type: z.enum(["breakfast", "lunch", "dinner", "snack"]).nullable(),
  amount_text: z.string().nullable(),
  amount_value: z.number().nullable(),
  amount_unit: z.string().nullable(),
  completion_ratio: z.number().nullable(),
  // 섭취 동기 (R19). 이유가 없으면 둘 다 null. 추측 금지.
  reason_text: z.string().nullable(),
  reason: z.enum(["hunger", "boredom", "craving", "social", "routine", "emotion"]).nullable(),
});

const moodPayloadSchema = z.object({
  label: z.string(),
  valence: z.number().int().min(-2).max(2),
  arousal: z.number().int().min(0).max(3),
  note: z.string().nullable(),
});

const sleepPayloadSchema = z.object({
  bedtime: z.string().nullable(),
  wake_time: z.string().nullable(),
  quality: z.number().int().min(1).max(5).nullable(),
  interruptions: z.number().int().nullable(),
  note: z.string().nullable(),
});

const energyPayloadSchema = z.object({
  level: z.number().int().min(1).max(5),
  note: z.string().nullable(),
});

const menstrualPayloadSchema = z.object({
  kind: z.enum(["start", "end", "ongoing"]),
  cycle_day: z.number().int().nullable(),
  flow: z.enum(["spotting", "light", "normal", "heavy"]).nullable(),
  pain: z.number().int().min(1).max(5).nullable(),
  note: z.string().nullable(),
});

const bowelPayloadSchema = z.object({
  bristol: z.number().int().min(1).max(7).nullable(),
  count: z.number().int().nullable(),
  note: z.string().nullable(),
});

const medicationPayloadSchema = z.object({
  kind: z.enum(["taken", "skipped", "dose_change"]),
  name: z.string(),
  dose_text: z.string().nullable(),
  dose_value: z.number().nullable(),
  dose_unit: z.string().nullable(),
  dose_from: z.string().nullable(),
  dose_to: z.string().nullable(),
  note: z.string().nullable(),
});

// activity — 운동·신체활동. (R18) intensity 는 숫자화하지 않고 원문 그대로.
const activityPayloadSchema = z.object({
  name: z.string(),
  duration_min: z.number().int().nullable(),
  distance_km: z.number().nullable(),
  intensity_text: z.string().nullable(),
  note: z.string().nullable(),
});

// appetite — 식욕·공복감. (R20) 강도/조절가능성은 숫자화하지 않고 원문 그대로.
const appetitePayloadSchema = z.object({
  kind: z.enum(["hunger", "fullness", "craving", "no_appetite"]),
  intensity_text: z.string().nullable(),
  controllable_text: z.string().nullable(),
  note: z.string().nullable(),
});

// digestion — 소화 감각. (R21) 배변 활동(bowel)과 구분.
const digestionPayloadSchema = z.object({
  kind: z.enum(["gas", "bloating", "heartburn", "pain", "nausea", "other"]),
  intensity_text: z.string().nullable(),
  note: z.string().nullable(),
});

const eventBase = {
  occurred_at: z.string(),
  occurred_at_precision: precisionSchema,
  is_range_expression: z.boolean(),
};

const llmEventSchema = z.discriminatedUnion("category", [
  z.object({ category: z.literal("food"), payload: foodPayloadSchema, ...eventBase }),
  z.object({ category: z.literal("mood"), payload: moodPayloadSchema, ...eventBase }),
  z.object({ category: z.literal("sleep"), payload: sleepPayloadSchema, ...eventBase }),
  z.object({ category: z.literal("energy"), payload: energyPayloadSchema, ...eventBase }),
  z.object({ category: z.literal("menstrual"), payload: menstrualPayloadSchema, ...eventBase }),
  z.object({ category: z.literal("bowel"), payload: bowelPayloadSchema, ...eventBase }),
  z.object({ category: z.literal("medication"), payload: medicationPayloadSchema, ...eventBase }),
  z.object({ category: z.literal("activity"), payload: activityPayloadSchema, ...eventBase }),
  z.object({ category: z.literal("appetite"), payload: appetitePayloadSchema, ...eventBase }),
  z.object({ category: z.literal("digestion"), payload: digestionPayloadSchema, ...eventBase }),
]);

const hypothesisSchema = z.object({
  statement: z.string(),
  cause_hint: z.string().nullable(),
  effect_hint: z.string().nullable(),
});

type LlmEvent = z.infer<typeof llmEventSchema>;
export type ParsedPayload = LlmEvent["payload"];

// ── 파이프라인 반환 타입 ─────────────────────────────────────────────────────
export interface ParsedEvent {
  category: Category;
  occurred_at: string;
  occurred_at_precision: OccurredAtPrecision;
  payload: ParsedPayload;
  confidence: number;
  needs_review: boolean;
}

export interface ParsedHypothesis {
  statement: string;
  cause_hint: string | null;
  effect_hint: string | null;
}

export interface ParseResult {
  events: ParsedEvent[];
  hypotheses: ParsedHypothesis[];
  unparsed: string[];
  parse_version: string;
}

/** JSON 파싱/재시도 후에도 실패하면 던진다. 호출부가 parse_error 에 기록한다. */
export class ParseError extends Error {
  override name = "ParseError";
}

// ── 구현 ─────────────────────────────────────────────────────────────────────
// 버전별 프롬프트 레지스트리. 프롬프트는 문자열 상수라 번들에 항상 포함된다(fs 접근 없음).
// 새 버전은 prompts/vN.ts 를 만들어 여기에 등록하고 PARSE_VERSION 을 올린다.
const PROMPTS: Record<string, string> = {
  v1: PROMPT_V1,
  v2: PROMPT_V2,
  v3: PROMPT_V3,
  v4: PROMPT_V4,
  v5: PROMPT_V5,
  v6: PROMPT_V6,
  v7: PROMPT_V7,
  v8: PROMPT_V8,
  v9: PROMPT_V9,
};

function loadSystemPrompt(version: string): string {
  const prompt = PROMPTS[version];
  if (!prompt) throw new Error(`알 수 없는 프롬프트 버전: ${version}`);
  return prompt;
}

function tryJson(text: string): { ok: boolean; value: unknown } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, value: null };
  }
}

/**
 * 코드펜스 제거: ```json / ``` 로 시작하면 첫 줄(펜스 여는 줄)을 지우고 끝의 ``` 를 지운다.
 * 펜스가 없으면 입력을 그대로 돌려준다(멀쩡한 출력을 건드리지 않음).
 */
function stripFence(t: string): string {
  if (!t.startsWith("```")) return t;
  const nl = t.indexOf("\n");
  let body = nl === -1 ? "" : t.slice(nl + 1); // 여는 줄(```json 등) 제거
  body = body.trimEnd();
  if (body.endsWith("```")) body = body.slice(0, -3); // 닫는 ``` 제거
  return body.trim();
}

/** 첫 '{' 부터 마지막 '}' 까지 잘라낸다(앞뒤 설명 문장 커버). 없으면 null. */
function sliceBraces(t: string): string | null {
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first === -1 || last === -1 || last < first) return null;
  return t.slice(first, last + 1);
}

export interface LenientJson {
  ok: boolean;
  value: unknown; // ok=false 면 무의미
  normalized: boolean; // 코드펜스/설명문 제거 등 전처리가 필요했는지
}

/**
 * 모델 출력을 JSON 으로 파싱한다. **추가 API 호출 없이** 같은 응답을 전처리만 한다.
 * 프롬프트에 코드펜스 금지가 명시돼 있어도 모델이 가끔 어기므로 코드에서 방어한다.
 * 순서: (1) trim 후 그대로 파싱 (2) 코드펜스 제거 후 파싱 (3) 첫 '{'~마지막 '}' 슬라이스 후 파싱.
 * 순수 JSON 은 (1)에서 통과하므로 정규화가 멀쩡한 입력을 망치지 않는다.
 */
export function parseJsonLenient(text: string): LenientJson {
  const t = text.trim();

  // (1) 순수 JSON — 정상 케이스.
  const direct = tryJson(t);
  if (direct.ok) return { ok: true, value: direct.value, normalized: false };

  // (2) 코드펜스 제거
  const defenced = stripFence(t);
  if (defenced !== t) {
    const r = tryJson(defenced);
    if (r.ok) return { ok: true, value: r.value, normalized: true };
  }

  // (3) 첫 '{' ~ 마지막 '}' 슬라이스
  const sliced = sliceBraces(defenced);
  if (sliced !== null && sliced !== defenced) {
    const r = tryJson(sliced);
    if (r.ok) return { ok: true, value: r.value, normalized: true };
  }

  return { ok: false, value: null, normalized: false };
}

/** 모델 호출 결과. text 외에 진단용 메타(stop_reason, 토큰)를 함께 돌려준다. */
interface ModelCall {
  text: string;
  stopReason: string | null;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
}

async function callModel(
  client: Anthropic,
  system: string,
  userJson: string,
  cachePrompt: boolean,
): Promise<ModelCall> {
  apiCallCount++;
  const msg = await client.messages.create({
    model: env.parseModel(),
    max_tokens: MAX_TOKENS,
    // 사고(extended thinking)를 명시적으로 끈다. 이 파서는 규칙이 프롬프트에 전부 있고
    // confidence 는 코드가 계산한다 — 모델의 자체 판단 여지를 없앤 설계라 사고가 불필요하다.
    // claude-sonnet-5 는 미지정 시 사고가 기본 ON 이고, 사고 토큰이 max_tokens 를 잠식해
    // 출력이 잘린다(진단 결과). 반드시 disabled 를 명시한다. (CLAUDE.md 참고)
    thinking: { type: "disabled" },
    // 프롬프트 캐싱(SDK 0.68 GA, beta 헤더 불필요)은 호출부가 켤 때만 건다.
    // 캐시 쓰기 1.25x / 읽기 0.1x 이므로 5분 TTL 안에 2회 이상 호출될 때만 이득 —
    // 골든 채점·배치 재파싱만 true. 단발 호출은 false(쓰기 프리미엄만 물게 됨).
    system: cachePrompt
      ? [{ type: "text", text: system, cache_control: { type: "ephemeral" } }]
      : system,
    messages: [{ role: "user", content: userJson }],
  });
  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const usage = msg.usage;
  // output_tokens_details.thinking_tokens 는 SDK 타입에 없을 수 있어 안전하게 읽는다.
  const thinkingTokens =
    (usage as { output_tokens_details?: { thinking_tokens?: number } }).output_tokens_details
      ?.thinking_tokens ?? 0;
  // 프롬프트 캐싱을 켜면 시스템 프롬프트(~16.8k)가 input_tokens 가 아니라 cache_read/creation
  // 으로 잡힌다. 실질 입력량을 보려면 셋을 합친다(안 그러면 캐시 적중 시 input 이 사용자 메시지만).
  totalInputTokens +=
    usage.input_tokens +
    (usage.cache_read_input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0);
  totalOutputTokens += usage.output_tokens;
  return {
    text,
    stopReason: msg.stop_reason,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    thinkingTokens,
  };
}

/**
 * 파싱 실패 시 진단 정보를 남긴다. 원본 출력을 통째로 찍으면 로그가 길어지므로 마지막 200자만.
 * 출력이 잘렸는지는 stop_reason="max_tokens" / output_tokens 로, 사고가 예산을 먹었는지는
 * thinking_tokens 로 드러난다.
 */
function logRawFailure(label: string, call: ModelCall): void {
  console.warn(
    `[parser] ${label} · length=${call.text.length} · stop_reason=${call.stopReason}` +
      ` · input_tokens=${call.inputTokens} · output_tokens=${call.outputTokens}` +
      ` · thinking_tokens=${call.thinkingTokens} · max_tokens=${MAX_TOKENS}`,
  );
  console.warn(`[parser] 원본 출력 마지막 200자: ${JSON.stringify(call.text.slice(-200))}`);
}

function validateAndScore(raw: unknown): ParseResult {
  const root = (raw ?? {}) as Record<string, unknown>;
  const events: ParsedEvent[] = [];
  const hypotheses: ParsedHypothesis[] = [];
  const unparsed: string[] = [];

  const rawEvents = Array.isArray(root.events) ? root.events : [];
  rawEvents.forEach((re, i) => {
    const parsed = llmEventSchema.safeParse(re);
    if (!parsed.success) {
      // 스키마 위반은 조용히 버리지 않고 경고를 남긴다.
      console.warn(
        `[parser] events[${i}] 스키마 위반, 제외: ${JSON.stringify(parsed.error.issues)}`,
      );
      return;
    }
    const e = parsed.data;
    const { confidence, needsReview } = computeConfidence({
      category: e.category,
      kind: e.category === "food" ? e.payload.kind : null,
      amountValue: e.category === "food" ? e.payload.amount_value : null,
      precision: e.occurred_at_precision,
      isRange: e.is_range_expression,
    });
    events.push({
      category: e.category,
      occurred_at: e.occurred_at,
      occurred_at_precision: e.occurred_at_precision,
      payload: e.payload,
      confidence,
      needs_review: needsReview,
    });
  });

  const rawHyps = Array.isArray(root.hypotheses) ? root.hypotheses : [];
  rawHyps.forEach((rh, i) => {
    const parsed = hypothesisSchema.safeParse(rh);
    if (!parsed.success) {
      console.warn(
        `[parser] hypotheses[${i}] 스키마 위반, 제외: ${JSON.stringify(parsed.error.issues)}`,
      );
      return;
    }
    hypotheses.push(parsed.data);
  });

  const rawUnparsed = Array.isArray(root.unparsed) ? root.unparsed : [];
  rawUnparsed.forEach((u, i) => {
    if (typeof u === "string") unparsed.push(u);
    else console.warn(`[parser] unparsed[${i}] 문자열이 아님, 제외`);
  });

  return { events, hypotheses, unparsed, parse_version: PARSE_VERSION };
}

/** 파싱 옵션. cachePrompt 는 5분 TTL 안에 같은 프롬프트로 2회 이상 호출될 때만 켠다. */
export interface ParseOptions {
  /** 시스템 프롬프트에 프롬프트 캐싱을 걸지 여부. 기본 false(단발 호출은 손해). */
  cachePrompt?: boolean;
  /** 최대 호출 횟수(JSON 실패 시 재시도 포함). 기본 2. 진단 시 1 로 두면 1회만 호출한다. */
  maxAttempts?: number;
}

/**
 * 발화 1건을 파싱한다. JSON 파싱 실패 시 1회 재시도하고, 그래도 실패하면 ParseError.
 * 단, stop_reason="max_tokens"(출력 한도 초과)는 재시도하지 않고 구분된 에러를 던진다 —
 * 같은 조건으로 다시 불러도 같은 결과라 호출만 낭비된다.
 * 스키마를 통과한 이벤트에만 R6 confidence 를 채운다.
 */
export async function parseTranscript(
  transcript: string,
  recordedAt: string,
  opts: ParseOptions = {},
): Promise<ParseResult> {
  const cachePrompt = opts.cachePrompt ?? false;
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 2);
  const system = loadSystemPrompt(PARSE_VERSION);
  const client = new Anthropic({ apiKey: env.anthropicApiKey() });
  const userJson = JSON.stringify({ transcript, recorded_at: recordedAt });

  let parsed: unknown = null;
  let succeeded = false;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const call = await callModel(client, system, userJson, cachePrompt);
    // 같은 응답에 대한 전처리(추가 호출 없음): 코드펜스/설명문을 벗겨 파싱을 시도한다.
    const lenient = parseJsonLenient(call.text);
    if (lenient.ok) {
      if (lenient.normalized) {
        // 얼마나 자주 일어나는지 세려고 한 줄 남긴다.
        console.warn("[parser] 출력에 코드펜스가 있어 제거함 (JSON 정규화 후 파싱 성공)");
      }
      parsed = lenient.value;
      succeeded = true;
      break;
    }
    // 실패한 출력은 버리지 않고 진단 정보를 남긴다(원인 확인용).
    // 출력 한도 초과는 재시도해도 같은 결과 → 원인을 가리지 않게 구분된 에러로 즉시 던진다.
    if (call.stopReason === "max_tokens") {
      logRawFailure("출력 한도 초과 (max_tokens)", call);
      throw new ParseError(
        `출력 한도 초과 (max_tokens ${MAX_TOKENS}) — 출력이 잘려 JSON 이 완성되지 않았다`,
      );
    }
    logRawFailure(`LLM 출력이 JSON 이 아님 (attempt ${attempt + 1}/${maxAttempts})`, call);
    if (attempt < maxAttempts - 1) console.warn("[parser] 재시도");
  }
  if (!succeeded) {
    throw new ParseError("LLM 출력이 유효한 JSON 이 아닙니다 (재시도 후에도 실패)");
  }

  return validateAndScore(parsed);
}
