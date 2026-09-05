import { describe, it, expect } from "vitest";
import { normalize, levenshtein, matchThing, shouldDeleteOrphanedThing } from "./thing-extract";

// ── helpers ──────────────────────────────────────────────────────────────────

function makeThing(id: string, kind: string, name: string, aliases: string[] = []) {
  return { id, kind, name, aliases };
}

// ── 재파싱 멱등성 ─────────────────────────────────────────────────────────────

describe("재파싱 멱등성", () => {
  it("같은 이름으로 두 번 매칭해도 merge 를 반환한다 (mention 중복 없음)", () => {
    const existing = [makeThing("abc", "treatment", "쥬베룩")];
    const norm = normalize("쥬베룩");

    const first = matchThing({ kind: "treatment", normalizedName: norm }, existing);
    const second = matchThing({ kind: "treatment", normalizedName: norm }, existing);

    // 두 번 모두 merge → DB 에서 upsert(onConflict) 가 중복 mention 을 막아 mention_count 불변.
    expect(first).toEqual({ type: "merge", thingId: "abc" });
    expect(second).toEqual({ type: "merge", thingId: "abc" });
  });

  it("alias 로 등록된 이름으로 재파싱해도 merge 를 반환한다", () => {
    const existing = [makeThing("abc", "product", "비타민D", ["vitamin D", "비타민d"])];
    const result = matchThing({ kind: "product", normalizedName: normalize("vitamin D") }, existing);
    expect(result).toEqual({ type: "merge", thingId: "abc" });
  });
});

// ── 사용자 손댄 흔적이 있는 thing 보존 ──────────────────────────────────────────

describe("mention 0 보존 규칙 — 사용자가 손댄 흔적이 있으면 삭제하지 않는다", () => {
  it("note 없음 + aliases 없음 → 삭제 대상 (순수 파생 데이터)", () => {
    expect(shouldDeleteOrphanedThing(null)).toBe(true);
    expect(shouldDeleteOrphanedThing({ note: null })).toBe(true);
    expect(shouldDeleteOrphanedThing({ note: "", aliases: [] })).toBe(true);
    expect(shouldDeleteOrphanedThing({ note: "   ", aliases: [] })).toBe(true);
  });

  it("note 있음 → 삭제하지 않음 (사용자 직접 작성 내용은 파생 데이터가 아니다)", () => {
    expect(shouldDeleteOrphanedThing({ note: "이 병원 원장쌤이 잘 맞아" })).toBe(false);
    expect(shouldDeleteOrphanedThing({ note: "3회차에 개선됨", aliases: [] })).toBe(false);
  });

  it("aliases 있음 → 삭제하지 않음 (사용자가 병합하거나 이름을 수정한 것)", () => {
    // renameThing: 이전 이름이 aliases 에 추가됨
    expect(shouldDeleteOrphanedThing({ note: null, aliases: ["쥬베룩 필러"] })).toBe(false);
    // mergeThings: loser 이름이 aliases 에 추가됨
    expect(shouldDeleteOrphanedThing({ aliases: ["물광주사", "스킨부스터"] })).toBe(false);
  });

  it("note 없고 aliases 도 없으면 aliases 키 자체가 없어도 삭제 대상", () => {
    expect(shouldDeleteOrphanedThing({ note: undefined })).toBe(true);
    expect(shouldDeleteOrphanedThing({ note: null, aliases: undefined })).toBe(true);
  });
});

// ── 편집거리 2 케이스 → candidate (자동 병합 금지) ────────────────────────────

describe("matchThing — 병합 규칙", () => {
  it("편집거리 2 이하 + same kind → candidate (자동 병합 안 함)", () => {
    const existing = [makeThing("abc", "treatment", "쥬베룩")];
    // "쥬베록" vs "쥬베룩": 1글자 치환 → 편집거리 1
    const result = matchThing({ kind: "treatment", normalizedName: normalize("쥬베록") }, existing);
    expect(result.type).toBe("candidate");
    expect((result as { type: "candidate"; thingId: string }).thingId).toBe("abc");
  });

  it("편집거리 2 이하 + 다른 kind → new (kind 가 다르면 후보도 아님)", () => {
    const existing = [makeThing("abc", "place", "쥬베룩")];
    const result = matchThing({ kind: "treatment", normalizedName: normalize("쥬베록") }, existing);
    expect(result.type).toBe("new");
  });

  it("편집거리 3 이상이고 포함 관계도 없으면 → new", () => {
    // "침술" vs "카이로프랙틱": 편집거리 >> 2, 포함 관계 없음
    const existing = [makeThing("abc", "treatment", "침술")];
    const result = matchThing({ kind: "treatment", normalizedName: normalize("카이로프랙틱") }, existing);
    expect(result.type).toBe("new");
  });

  it("완전 일치 → merge (편집거리 0)", () => {
    const existing = [makeThing("xyz", "place", "강남차병원")];
    const result = matchThing({ kind: "place", normalizedName: normalize("강남차병원") }, existing);
    expect(result).toEqual({ type: "merge", thingId: "xyz" });
  });
});

// ── normalize / levenshtein 단위 검증 ────────────────────────────────────────

describe("normalize", () => {
  it("소문자·공백·구분자 제거", () => {
    expect(normalize("비타민 D")).toBe("비타민d");
    expect(normalize("Vitamin-D")).toBe("vitamind");
    expect(normalize("강남 차 병원")).toBe("강남차병원");
  });
});

describe("levenshtein", () => {
  it("같은 문자열 → 0", () => expect(levenshtein("abc", "abc")).toBe(0));
  it("빈 문자열 → 상대 길이", () => expect(levenshtein("", "abc")).toBe(3));
  it("1글자 치환 → 1", () => expect(levenshtein("쥬베룩", "쥬베록")).toBe(1));
  it("2글자 차이 → 2", () => expect(levenshtein("abcd", "ab")).toBe(2));
});
