-- 다중 사용자(가족 3명). Supabase Auth 없이 app_users.ingest_token 으로 사용자를 식별한다.
-- ⚠️ 진짜 보안 경계가 아니다: 토큰을 아는 사람은 그 사용자의 기록을 볼 수 있다.
--    가족 3명 + 전원 동의 전제에서만 쓰는 구조다. (CLAUDE.md "다중 사용자 / 보안" 참고)
-- 0001~0005 는 수정하지 않는다.
--
-- 시드(사용자 행 INSERT)는 여기 넣지 않는다. 마이그레이션은 git 에 커밋되므로 토큰이
-- 이력에 영구히 남는다. 사용자 추가는 Supabase SQL Editor 에서 수동 실행한다.
-- 절차: docs/multi-user-setup.md 참고.

create table app_users (
  id           uuid primary key default gen_random_uuid(),
  label        text not null, -- '나', '엄마' 같은 표시용
  ingest_token text not null unique,
  created_at   timestamptz not null default now()
);

-- 서버(service role)만 조회한다. anon/authenticated 접근은 정책 없이 차단.
alter table app_users enable row level security;
