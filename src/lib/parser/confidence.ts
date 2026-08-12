import type { Category, FoodKind, OccurredAtPrecision } from "@/lib/db/schema";

/**
 * confidence 계산 (RULES.md R6). LLM 은 confidence 를 출력하지 않는다 —
 * LLM 은 판정에 필요한 사실만 뽑고, 이 함수가 결정적으로 점수를 매긴다.
 * (골든 테스트가 산수 정확도가 아니라 파싱 품질을 재도록.)
 */
export interface ConfidenceInput {
  category: Category;
  kind: FoodKind | null; // food 계열이 아니면 null
  amountValue: number | null;
  precision: OccurredAtPrecision;
  isRange: boolean; // R7 범위 표현을 최솟값으로 취했는지
}

export interface ConfidenceResult {
  confidence: number;
  needsReview: boolean;
}

/**
 * 1.00 에서 시작해 차감. 하한 0.30. confidence < 0.70 이면 needs_review.
 * 부동소수 오차를 피하려고 정수 100분위로 계산한다.
 */
export function computeConfidence(input: ConfidenceInput): ConfidenceResult {
  let score = 100;

  // 양이 모호하거나 미언급(amount_value === null) — 단, kind 가 food/drink 일 때만.
  // skipped_meal 은 "양" 개념이 없으므로 차감하지 않는다. (R5/R6)
  const isFoodOrDrink = input.kind === "food" || input.kind === "drink";
  if (isFoodOrDrink && input.amountValue === null) score -= 30;

  // 시각이 추정임 (exact 가 아님)
  if (input.precision !== "exact") score -= 20;

  // 범위 표현을 최솟값으로 취함 (R7)
  if (input.isRange) score -= 20;

  if (score < 30) score = 30; // 하한

  return { confidence: score / 100, needsReview: score < 70 };
}
