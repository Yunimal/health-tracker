import { NextResponse } from "next/server";

/**
 * POST /api/parse — 파싱 트리거 엔드포인트.
 *
 * 주어진 raw_entry(들)를 현재 프롬프트 버전으로 파싱하여 events/hypotheses 를
 * 생성한다. events/hypotheses 는 파생 데이터이므로 재파싱 시 삭제 후 재생성한다.
 * (기획서 §5.1)
 *
 * TODO(STEP 3): raw_entry 로드 → LLM 파싱 → 기존 파생 데이터 삭제 → INSERT →
 *   raw_entries.parse_version / parsed_at / parse_error 갱신.
 */
export async function POST(): Promise<NextResponse> {
  return NextResponse.json({ error: "not_implemented" }, { status: 501 });
}
