import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { env } from "@/lib/env";
import { computeConfidence } from "./confidence";
import { PROMPT_V1 } from "./prompts/v1";
import { PROMPT_V2 } from "./prompts/v2";
import type { Category, OccurredAtPrecision } from "@/lib/db/schema";

/**
 * LLM 파싱 파이프라인. (기획서 §6, tests/golden/RULES.md)
 *
 * 설계: LLM 은 confidence/needs_review 를 출력하지 않는다. 판정에 필요한 사실만
 * 뽑고(payload + is_range_expression), confidence 는 computeConfidence 가 R6 로 계산한다.
 */

export const PARSE_MODEL = "claude-opus-4-8";

/** 프롬프트 파일명과 동기화한다. 프롬프트를 고치면 prompts/vN.ts 를 새로 만들고 이 값을 올린다. */
export const PARSE_VERSION = "v2";

const MAX_TOKENS = 4096;

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
const PROMPTS: Record<string, string> = { v1: PROMPT_V1, v2: PROMPT_V2 };

function loadSystemPrompt(version: string): string {
  const prompt = PROMPTS[version];
  if (!prompt) throw new Error(`알 수 없는 프롬프트 버전: ${version}`);
  return prompt;
}

/** 프롬프트는 펜스 금지지만, 방어적으로 코드펜스를 벗겨낸다. */
function stripFences(text: string): string {
  const t = text.trim();
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return m ? m[1]!.trim() : t;
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(stripFences(text));
  } catch {
    return null;
  }
}

async function callModel(client: Anthropic, system: string, userJson: string): Promise<string> {
  const msg = await client.messages.create({
    model: PARSE_MODEL,
    max_tokens: MAX_TOKENS,
    system,
    messages: [{ role: "user", content: userJson }],
  });
  return msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
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

/**
 * 발화 1건을 파싱한다. JSON 파싱 실패 시 1회 재시도하고, 그래도 실패하면 ParseError.
 * 스키마를 통과한 이벤트에만 R6 confidence 를 채운다.
 */
export async function parseTranscript(
  transcript: string,
  recordedAt: string,
): Promise<ParseResult> {
  const system = loadSystemPrompt(PARSE_VERSION);
  const client = new Anthropic({ apiKey: env.anthropicApiKey() });
  const userJson = JSON.stringify({ transcript, recorded_at: recordedAt });

  let parsed: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await callModel(client, system, userJson);
    parsed = tryParseJson(text);
    if (parsed !== null) break;
    if (attempt === 0) console.warn("[parser] LLM 출력이 JSON 이 아님 — 1회 재시도");
  }
  if (parsed === null) {
    throw new ParseError("LLM 출력이 유효한 JSON 이 아닙니다 (재시도 후에도 실패)");
  }

  return validateAndScore(parsed);
}
