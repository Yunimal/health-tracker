import { describe, it, expect } from "vitest";
import { parseJsonLenient } from "@/lib/parser";

/**
 * JSON 전처리(parseJsonLenient) 단위 테스트 — **API 호출 없음.**
 * 모델이 프롬프트의 펜스 금지를 어기고 ```json 으로 감싸거나 앞뒤에 설명을 붙여도
 * 같은 응답을 코드에서 방어적으로 파싱한다. 순수 JSON 은 건드리지 않아야 한다.
 */

// 파서가 실제로 받는 모양과 비슷한 최소 객체.
const OBJ = { events: [{ category: "food" }], hypotheses: [], unparsed: ["x"] };
const JSON_STR = JSON.stringify(OBJ);

describe("parseJsonLenient", () => {
  it("펜스로 감싼 JSON(```json)을 벗겨 파싱한다", () => {
    const raw = "```json\n" + JSON_STR + "\n```";
    const r = parseJsonLenient(raw);
    expect(r.ok).toBe(true);
    expect(r.normalized).toBe(true);
    expect(r.value).toEqual(OBJ);
  });

  it("언어 태그 없는 펜스(```)도 벗겨 파싱한다", () => {
    const raw = "```\n" + JSON_STR + "\n```";
    const r = parseJsonLenient(raw);
    expect(r.ok).toBe(true);
    expect(r.normalized).toBe(true);
    expect(r.value).toEqual(OBJ);
  });

  it("앞에 설명 문장이 붙은 JSON 을 잘라내 파싱한다", () => {
    const raw = "다음은 파싱 결과입니다:\n" + JSON_STR;
    const r = parseJsonLenient(raw);
    expect(r.ok).toBe(true);
    expect(r.normalized).toBe(true);
    expect(r.value).toEqual(OBJ);
  });

  it("앞뒤로 설명 문장이 붙어도 첫 '{'~마지막 '}' 로 잘라 파싱한다", () => {
    const raw = "여기 있습니다: " + JSON_STR + " 이상입니다.";
    const r = parseJsonLenient(raw);
    expect(r.ok).toBe(true);
    expect(r.normalized).toBe(true);
    expect(r.value).toEqual(OBJ);
  });

  it("순수 JSON 은 정규화 없이 그대로 파싱한다(멀쩡한 입력을 망치지 않음)", () => {
    const r = parseJsonLenient(JSON_STR);
    expect(r.ok).toBe(true);
    expect(r.normalized).toBe(false);
    expect(r.value).toEqual(OBJ);
  });

  it("앞뒤 공백만 있는 순수 JSON 도 정규화 없이 파싱한다", () => {
    const r = parseJsonLenient("\n  " + JSON_STR + "  \n");
    expect(r.ok).toBe(true);
    expect(r.normalized).toBe(false);
    expect(r.value).toEqual(OBJ);
  });

  it("정말 JSON 이 아니면 실패한다(설명만 있는 경우)", () => {
    const r = parseJsonLenient("죄송합니다. 이 발화는 파싱할 수 없습니다.");
    expect(r.ok).toBe(false);
  });

  it("여는 중괄호만 있고 닫히지 않으면 실패한다", () => {
    const r = parseJsonLenient('{ "events": [ ');
    expect(r.ok).toBe(false);
  });

  it("빈 문자열은 실패한다", () => {
    const r = parseJsonLenient("   ");
    expect(r.ok).toBe(false);
  });
});
