/**
 * 환경 변수 접근 지점. 서버 전용.
 *
 * 사용자 식별은 env 가 아니라 app_users.ingest_token 으로 한다. (@/lib/auth, 0006_multi_user)
 * USER_ID / INGEST_TOKEN 환경 변수는 더 이상 쓰지 않는다.
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
  // 파싱 모델. env(PARSE_MODEL)로 오버라이드 가능. 기본값 claude-sonnet-5 —
  // v6 골든셋에서 Opus 4.8 과 동일한 41/41 만점(오분류 0)인데 비용이 훨씬 낮다.
  parseModel: () => process.env.PARSE_MODEL ?? "claude-sonnet-5",
};
