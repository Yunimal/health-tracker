-- 0004: hidden_at(소프트 삭제 메타데이터)은 UPDATE 허용, 원문 필드는 여전히 불변. (기획서 §5.1)
-- 실행: `supabase test db` (pgTAP). rollback 으로 흔적을 남기지 않는다.

begin;
select plan(3);

insert into raw_entries (id, user_id, source, transcript)
values (
  '00000000-0000-0000-0000-0000000000aa',
  '00000000-0000-0000-0000-0000000000b0',
  'text',
  '원문 그대로'
);

-- 1) hidden_at 을 채우는 UPDATE(숨기기) → 허용.
select lives_ok(
  $$ update raw_entries set hidden_at = now()
       where id = '00000000-0000-0000-0000-0000000000aa' $$,
  'hidden_at 설정(숨기기) UPDATE 는 허용되어야 한다'
);

-- 2) hidden_at 을 다시 null 로(복원) → 허용.
select lives_ok(
  $$ update raw_entries set hidden_at = null
       where id = '00000000-0000-0000-0000-0000000000aa' $$,
  'hidden_at 해제(복원) UPDATE 는 허용되어야 한다'
);

-- 3) transcript 는 여전히 거부.
select throws_ok(
  $$ update raw_entries set transcript = '변조됨'
       where id = '00000000-0000-0000-0000-0000000000aa' $$,
  NULL, NULL,
  'transcript UPDATE 는 여전히 거부되어야 한다'
);

select * from finish();
rollback;
