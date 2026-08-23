import { describe, it, expect } from "vitest";
import { getOutcome, classifyScaleValue, type ScaleOutcome, type AnalysisEvent } from "./outcomes";
import { compareOutcome, withinLookback } from "./compare";
import { extractInputFactors } from "./inputs";

// ── 테스트용 이벤트 빌더 ──────────────────────────────────────────────────────
function ev(
  category: AnalysisEvent["category"],
  occurred_at: string,
  payload: Record<string, unknown>,
): AnalysisEvent {
  return { category, occurred_at, payload };
}
const sleep = (iso: string, quality: number | null) =>
  ev("sleep", iso, { bedtime: null, wake_time: null, quality, interruptions: null, note: null });
const food = (iso: string, name: string) =>
  ev("food", iso, { name, kind: "food", meal_type: null });

describe("레지스트리 배선 (DRAFT7)", () => {
  it("focus 가 scale 결과로 등록돼 있다 (level 1~5, high_good, good[4,5] bad[1,2], lookback 12h)", () => {
    const f = getOutcome("focus") as ScaleOutcome;
    expect(f).toBeDefined();
    expect(f.kind).toBe("scale");
    expect(f.category).toBe("focus");
    expect(f.valuePath).toBe("level");
    expect(f.direction).toBe("high_good");
    expect(f.goodRange).toEqual([4, 5]);
    expect(f.badRange).toEqual([1, 2]);
    expect(f.lookbackHours).toBe(12);
  });

  it("environment 는 결과가 아니라 원인 후보 — 카테고리 존재 factor 로 자동 포함", () => {
    const factors = extractInputFactors([]);
    expect(factors.some((f) => f.id === "has:environment")).toBe(true);
    // 결과 레지스트리에는 없어야 한다(원인 후보이지 결과가 아니다).
    expect(getOutcome("environment")).toBeUndefined();
  });
});

describe("classifyScaleValue — mid_good (브리스톨 1,4,7)", () => {
  const bowel = getOutcome("bowel") as ScaleOutcome;

  it("양 끝(1,7)은 bad, 가운데(4)는 good", () => {
    expect(classifyScaleValue(bowel, 1)).toBe("bad");
    expect(classifyScaleValue(bowel, 4)).toBe("good");
    expect(classifyScaleValue(bowel, 7)).toBe("bad");
  });

  it("경계값 확인 (2,3,5,6)", () => {
    expect(classifyScaleValue(bowel, 2)).toBe("bad");
    expect(classifyScaleValue(bowel, 3)).toBe("good");
    expect(classifyScaleValue(bowel, 5)).toBe("good");
    expect(classifyScaleValue(bowel, 6)).toBe("bad");
  });

  it("high_good 에서 구간 밖은 middle (수면 질 3)", () => {
    const sq = getOutcome("sleep_quality") as ScaleOutcome;
    expect(classifyScaleValue(sq, 3)).toBe("middle");
    expect(classifyScaleValue(sq, 5)).toBe("good");
    expect(classifyScaleValue(sq, 1)).toBe("bad");
  });
});

describe("unknownDays — good/bad 어디에도 들어가지 않는다", () => {
  it("결과 기록이 없는 날은 unknown, 좋았던 날에 섞이지 않는다", () => {
    const events = [
      sleep("2026-08-18T07:00:00+09:00", 5), // good
      food("2026-08-19T12:00:00+09:00", "김밥"), // sleep 기록 없음 → unknown
      // 08-20 은 아무 기록도 없음 → unknown
    ];
    const r = compareOutcome("sleep_quality", events, 3, { today: "2026-08-20" });

    expect(r.goodDays).toEqual(["2026-08-18"]);
    expect(r.badDays).toEqual([]);
    expect(r.unknownDays).toContain("2026-08-19");
    expect(r.unknownDays).toContain("2026-08-20");

    // 교집합이 비어야 한다.
    for (const d of r.unknownDays) {
      expect(r.goodDays).not.toContain(d);
      expect(r.badDays).not.toContain(d);
    }
  });
});

describe("enoughData 경계 (4일/5일)", () => {
  const days = (start: number, n: number) =>
    Array.from({ length: n }, (_, i) => `2026-08-${String(start + i).padStart(2, "0")}`);

  it("good/bad 각 5일이면 enoughData=true", () => {
    const events = [
      ...days(8, 5).map((d) => sleep(`${d}T07:00:00+09:00`, 5)), // 08-08~08-12 good
      ...days(13, 5).map((d) => sleep(`${d}T07:00:00+09:00`, 1)), // 08-13~08-17 bad
    ];
    const r = compareOutcome("sleep_quality", events, 14, { today: "2026-08-20" });
    expect(r.goodDays.length).toBe(5);
    expect(r.badDays.length).toBe(5);
    expect(r.enoughData).toBe(true);
    expect(r.minSamplesNeeded).toBe(5);
  });

  it("good 이 4일이면 enoughData=false", () => {
    const events = [
      ...days(8, 4).map((d) => sleep(`${d}T07:00:00+09:00`, 5)), // good 4일
      ...days(13, 5).map((d) => sleep(`${d}T07:00:00+09:00`, 1)), // bad 5일
    ];
    const r = compareOutcome("sleep_quality", events, 14, { today: "2026-08-20" });
    expect(r.goodDays.length).toBe(4);
    expect(r.badDays.length).toBe(5);
    expect(r.enoughData).toBe(false);
  });
});

describe("lookback 이 날짜 경계를 넘어갈 때 (전날 22시 음식 → 당일 수면)", () => {
  it("withinLookback: 전날 22:00 은 당일 07:00 기준 18h 창 안, 8h 창 밖", () => {
    const anchor = "2026-08-10T07:00:00+09:00";
    const prevNight = "2026-08-09T22:00:00+09:00"; // 9시간 전
    expect(withinLookback(prevNight, anchor, 18)).toBe(true);
    expect(withinLookback(prevNight, anchor, 8)).toBe(false);
    // anchor 이후 시각은 창 밖(원인은 결과보다 앞이어야 한다)
    expect(withinLookback("2026-08-10T08:00:00+09:00", anchor, 18)).toBe(false);
  });

  it("compareOutcome: 전날 밤 커피가 당일 수면의 lookback 창에 잡힌다", () => {
    const events = [
      sleep("2026-08-10T07:00:00+09:00", 1), // 08-10 bad (anchor 07:00, lookback 18h)
      food("2026-08-09T22:00:00+09:00", "커피"), // 전날 밤 → 창 안(9h 전)
      food("2026-08-06T22:00:00+09:00", "커피"), // 커피가 2일 이상 등장해야 factor 로 잡힘
    ];
    const r = compareOutcome("sleep_quality", events, 7, { today: "2026-08-12" });

    expect(r.badDays).toEqual(["2026-08-10"]);
    expect(r.goodDays).toEqual([]);

    const coffee = r.factors.find((f) => f.id === "name:food:커피");
    expect(coffee).toBeDefined();
    expect(coffee!.badTotal).toBe(1);
    expect(coffee!.badCount).toBe(1); // 전날 밤 커피가 날짜 경계를 넘어 창에 들어옴
  });

  it("extractInputFactors: 2일 이상 등장한 이름만 factor 가 된다", () => {
    const twice = [food("2026-08-06T22:00:00+09:00", "커피"), food("2026-08-09T22:00:00+09:00", "커피")];
    const once = [food("2026-08-06T22:00:00+09:00", "우유")];
    expect(extractInputFactors(twice).some((f) => f.id === "name:food:커피")).toBe(true);
    expect(extractInputFactors(once).some((f) => f.id === "name:food:우유")).toBe(false);
  });
});

describe("presence 결과 (craving) — good 은 최소 기록 밀도(≥3건)를 넘어야 한다", () => {
  it("매칭=bad / 무매칭+기록충분=good / 무매칭+기록부족=unknown / 무기록=unknown", () => {
    const events = [
      // 08-18: 기록 3건, craving 없음 → good
      food("2026-08-18T08:00:00+09:00", "토스트"),
      food("2026-08-18T12:00:00+09:00", "김밥"),
      ev("mood", "2026-08-18T21:00:00+09:00", { label: "괜찮음", valence: 1, arousal: 1, note: null }),
      // 08-19: craving → bad
      ev("appetite", "2026-08-19T15:00:00+09:00", { kind: "craving" }),
      // 08-20: 기록 1건뿐, craving 없음 → unknown (밀도 미달)
      food("2026-08-20T12:00:00+09:00", "김밥"),
      // 08-21: 무기록 → unknown
    ];
    const r = compareOutcome("craving", events, 4, { today: "2026-08-21" });
    expect(r.goodDays).toEqual(["2026-08-18"]);
    expect(r.badDays).toEqual(["2026-08-19"]);
    expect(r.unknownDays).toContain("2026-08-20"); // 기록 1건 → 판단 보류
    expect(r.unknownDays).toContain("2026-08-21"); // 무기록
    expect(r.goodDays).not.toContain("2026-08-20");
  });

  it("PRESENCE_GOOD_MIN_EVENTS 경계: 2건이면 unknown, 3건이면 good", () => {
    const twoDay = [
      food("2026-08-18T08:00:00+09:00", "토스트"),
      food("2026-08-18T12:00:00+09:00", "김밥"),
    ];
    const r2 = compareOutcome("craving", twoDay, 1, { today: "2026-08-18" });
    expect(r2.goodDays).toEqual([]);
    expect(r2.unknownDays).toEqual(["2026-08-18"]);

    const r3 = compareOutcome("craving", [...twoDay, food("2026-08-18T19:00:00+09:00", "사과")], 1, {
      today: "2026-08-18",
    });
    expect(r3.goodDays).toEqual(["2026-08-18"]);
  });
});
