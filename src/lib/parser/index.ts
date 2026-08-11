/**
 * LLM 파싱 로직.
 *
 * 입력: transcript + recorded_at(ISO8601, KST) + 사용자 개인 사전
 * 출력: { events, hypotheses, unparsed } JSON 단독 (기획서 §6.1)
 *
 * 핵심 규칙 (기획서 §6.2):
 *  - 수치를 지어내지 않는다. 모르면 amount_value: null, amount_text 만 채운다.
 *  - confidence < 0.7 이면 needs_review: true
 *  - "~인가?", "~해서 그런가" 같은 추측은 event 가 아니라 hypothesis.
 *  - 해석 불가한 조각은 버리지 말고 unparsed 에 담는다.
 *
 * TODO(STEP 3): Anthropic SDK structured output 으로 파싱 구현.
 */
export {};
