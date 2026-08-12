/**
 * DB 조회 공통 필터. **숨김(soft delete) 규칙은 여기 한 곳에만 둔다.**
 *
 * 타임라인, GET /api/entries, 그리고 향후 분석/집계 단계까지 모두 이 함수를 거쳐
 * "hidden_at 이 있는(=숨긴) 원문은 제외"를 보장해야 한다. 숨긴 원문은 목록뿐 아니라
 * 분석에서도 빠져야 하므로, 필터를 흩어놓지 말고 여기서만 관리한다. (기획서 §5.1)
 *
 * 서버 전용 모듈에 두지 않는다(순수 쿼리 헬퍼) — API 라우트/서버 컴포넌트 어디서든 쓴다.
 */
export function excludeHidden<Q extends { is(column: string, value: null): Q }>(query: Q): Q {
  return query.is("hidden_at", null);
}
