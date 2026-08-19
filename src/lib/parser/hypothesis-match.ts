import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";
import { parseJsonLenient } from "@/lib/parser";

/**
 * 가설 의미 매칭 — 파싱과 **분리된 별도 LLM 호출**. (기능 [1])
 * 새로 뽑힌 가설이 기존 open 가설 중 **같은 의심**인지 판정한다. 문자열 일치가 아니라
 * cause/effect 의 의미 동일성으로 본다. 프롬프트는 짧게(비용 낮춤), thinking 은 끈다.
 *
 * 호출 전제(호출부 책임): incoming·existing 둘 다 1건 이상일 때만 부른다.
 * 실패/애매/알 수 없는 id 는 전부 null(=병합 안 함)로 폴백한다 — 잘못된 병합이 놓치는 것보다 해롭다.
 */
export interface ExistingHypothesis {
  id: string;
  cause_hint: string | null;
  effect_hint: string | null;
}
export interface IncomingHypothesis {
  cause_hint: string | null;
  effect_hint: string | null;
}

const MAX_TOKENS = 1024;

const SYSTEM = `너는 건강 기록의 "의심(가설)"들이 같은 의심인지 판정한다.
각 가설은 cause(원인)와 effect(결과)로 표현된다. 두 가설은 원인과 결과가 **의미상 같은 것을
가리키면** 같은 의심이다(표현이 달라도). 단어가 비슷하다고 같은 게 아니라, 실제로 같은 인과를
의심하는지로 판단한다.

입력 JSON:
{ "existing": [{ "id": "...", "cause": "...", "effect": "..." }],
  "incoming": [{ "index": 0, "cause": "...", "effect": "..." }] }

출력: 아래 JSON 하나만. 코드펜스도 다른 텍스트도 붙이지 않는다.
{ "matches": [{ "index": 0, "matched_id": "<existing 의 id 또는 null>" }] }

- incoming 각 항목마다, existing 중 같은 의심이 있으면 그 id, 없으면 null.
- 애매하면 null. 억지로 병합하지 않는다(잘못된 병합이 놓치는 것보다 해롭다).`;

/** incoming 각 항목에 대응하는 기존 가설 id 배열(같은 순서). 매칭 없으면 그 자리 null. */
export async function matchHypotheses(
  existing: ExistingHypothesis[],
  incoming: IncomingHypothesis[],
): Promise<(string | null)[]> {
  const result: (string | null)[] = incoming.map(() => null);
  if (incoming.length === 0 || existing.length === 0) return result;

  const client = new Anthropic({ apiKey: env.anthropicApiKey() });
  const userJson = JSON.stringify({
    existing: existing.map((e) => ({ id: e.id, cause: e.cause_hint, effect: e.effect_hint })),
    incoming: incoming.map((h, i) => ({ index: i, cause: h.cause_hint, effect: h.effect_hint })),
  });

  const msg = await client.messages.create({
    model: env.parseModel(),
    max_tokens: MAX_TOKENS,
    thinking: { type: "disabled" }, // 파싱과 동일 — 규칙이 프롬프트에 있어 사고 불필요. (CLAUDE.md)
    system: SYSTEM,
    messages: [{ role: "user", content: userJson }],
  });
  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const parsed = parseJsonLenient(text);
  if (!parsed.ok) return result; // 파싱 실패 → 전부 null(병합 없음). 안전한 폴백.

  const validIds = new Set(existing.map((e) => e.id));
  const root = parsed.value as { matches?: unknown };
  const matches = Array.isArray(root.matches) ? root.matches : [];
  for (const m of matches) {
    if (!m || typeof m !== "object") continue;
    const idx = (m as { index?: unknown }).index;
    const matchedId = (m as { matched_id?: unknown }).matched_id;
    // 범위 밖 index / 목록에 없는 id 는 무시(방어적).
    if (typeof idx !== "number" || idx < 0 || idx >= result.length) continue;
    if (typeof matchedId === "string" && validIds.has(matchedId)) result[idx] = matchedId;
  }
  return result;
}
