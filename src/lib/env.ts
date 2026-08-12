/**
 * 환경 변수 접근 지점. 서버 전용.
 *
 * Phase 0 는 인증이 없다. USER_ID 환경 변수에 고정된 단일 사용자 UUID 로
 * 모든 레코드를 귀속시킨다. (기획서 §4.3, 로드맵 Phase 0)
 *
 * TODO: 실제 사용 시 각 값의 존재를 검증하고 없으면 부팅을 막는다.
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const env = {
  supabaseUrl: () => required("SUPABASE_URL"),
  supabaseServiceRoleKey: () => required("SUPABASE_SERVICE_ROLE_KEY"),
  anthropicApiKey: () => required("ANTHROPIC_API_KEY"),
  userId: () => required("USER_ID"),
  // /api/entries 수신 인증용 공유 토큰. iOS 단축어가 Bearer 로 보낸다.
  ingestToken: () => required("INGEST_TOKEN"),
};
