import { describe, it, expect } from "vitest";
import { computeConfidence } from "./confidence";

describe("computeConfidence (R6)", () => {
  it("모두 만족: food + 양 있음 + exact → 1.00, needs_review false", () => {
    expect(
      computeConfidence({
        category: "food",
        kind: "food",
        amountValue: 2,
        precision: "exact",
        isRange: false,
      }),
    ).toEqual({ confidence: 1.0, needsReview: false });
  });

  it("경계값: food + 양 null + exact → 0.70, needs_review false (0.70 은 미만이 아님)", () => {
    expect(
      computeConfidence({
        category: "food",
        kind: "drink",
        amountValue: null,
        precision: "exact",
        isRange: false,
      }),
    ).toEqual({ confidence: 0.7, needsReview: false });
  });

  it("경계 바로 아래: 양 있음 + precision hour → 0.80 (참고용 상단 경계)", () => {
    expect(
      computeConfidence({
        category: "food",
        kind: "food",
        amountValue: 1,
        precision: "hour",
        isRange: false,
      }),
    ).toEqual({ confidence: 0.8, needsReview: false });
  });

  it("food + 양 null + part_of_day → 0.50, needs_review true", () => {
    expect(
      computeConfidence({
        category: "food",
        kind: "food",
        amountValue: null,
        precision: "part_of_day",
        isRange: false,
      }),
    ).toEqual({ confidence: 0.5, needsReview: true });
  });

  it("skipped_meal 은 양 페널티를 받지 않는다: precision part_of_day → 0.80", () => {
    expect(
      computeConfidence({
        category: "food",
        kind: "skipped_meal",
        amountValue: null,
        precision: "part_of_day",
        isRange: false,
      }),
    ).toEqual({ confidence: 0.8, needsReview: false });
  });

  it("sleep: 양 개념 없음, precision hour + 범위 → 0.60, needs_review true (case-010)", () => {
    expect(
      computeConfidence({
        category: "sleep",
        kind: null,
        amountValue: null,
        precision: "hour",
        isRange: true,
      }),
    ).toEqual({ confidence: 0.6, needsReview: true });
  });

  it("energy: 양 개념 없음이면 amount null 이어도 페널티 없음, part_of_day → 0.80", () => {
    expect(
      computeConfidence({
        category: "energy",
        kind: null,
        amountValue: null,
        precision: "part_of_day",
        isRange: false,
      }),
    ).toEqual({ confidence: 0.8, needsReview: false });
  });

  it("하한 0.30: food + 양 null + part_of_day + 범위 → 0.30 (100-30-20-20)", () => {
    expect(
      computeConfidence({
        category: "food",
        kind: "drink",
        amountValue: null,
        precision: "part_of_day",
        isRange: true,
      }),
    ).toEqual({ confidence: 0.3, needsReview: true });
  });

  it("범위 표현만으로도 -0.20: energy + exact + 범위 → 0.80", () => {
    expect(
      computeConfidence({
        category: "energy",
        kind: null,
        amountValue: null,
        precision: "exact",
        isRange: true,
      }),
    ).toEqual({ confidence: 0.8, needsReview: false });
  });
});
