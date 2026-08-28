import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";

/**
 * 성찰("같이 생각해보기") 응답 생성. **사용자가 버튼을 눌러 요청할 때만** 호출한다(자동 생성 X).
 * 진단·처방을 하지 않고 되물어주는 방향으로, 판단어 없이 짧게. (기능 A, CLAUDE.md 원칙 6)
 */

export const REFLECT_REPLY_PROMPT = `당신은 사용자의 성찰 기록에 짧게 응답하는 대화 상대다. 진단하거나 처방하지 않는다.

user 메시지로 아래 JSON 이 주어진다.
{ "reflection": "사용자의 생각·고민 원문", "facts": "이 사용자의 기록에서 코드가 뽑은 사실(없으면 빈 문자열)" }

규칙:
- **결론이나 조언을 내리지 마라.** "폰을 줄이세요", "~하는 게 좋아요" 같은 처방·해결책 제시 금지.
- **되물어주는 방향으로.** 사용자가 스스로 생각을 정리하도록 질문을 건넨다.
- **판단하는 표현 금지.** 좋다/나쁘다/문제다/잘못 같은 평가어를 쓰지 않는다. 관찰을 돕는 것이지
  자책하게 만드는 게 아니다.
- facts 에 주어진 사실이 성찰과 관련되면 **그 사실만** 담담히 연결한다(예: "이런 생각을 적으신
  날들을 보니 저녁 시간이 많았네요"). facts 가 비었거나 관련이 없으면 억지로 끌어오지 마라.
  **사실을 지어내지 마라.**
- **3~4문장 이내로 짧게.** 평문만 쓴다(마크다운·목록·JSON 금지).
- 응답 텍스트만 출력한다. 다른 설명을 붙이지 않는다.`;

/**
 * @param reflectionText 사용자의 성찰 원문
 * @param facts 코드가 사용자 기록에서 계산한 사실 문자열(없으면 빈 문자열) — 모델이 지어내지 않게
 */
export async function generateReflectionReply(
  reflectionText: string,
  facts: string,
): Promise<string> {
  const client = new Anthropic({ apiKey: env.anthropicApiKey() });
  const msg = await client.messages.create({
    model: env.parseModel(),
    max_tokens: 512,
    // 파싱과 같은 이유로 확장 사고를 끈다(출력 잘림 방지). 짧은 응답이라 사고 불필요.
    thinking: { type: "disabled" },
    system: REFLECT_REPLY_PROMPT,
    messages: [{ role: "user", content: JSON.stringify({ reflection: reflectionText, facts }) }],
  });
  return msg.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();
}
