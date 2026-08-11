-- raw_entries 원문 불변 트리거(0002) 검증. (기획서 §5.1)
--
-- 실행: `supabase test db` (pgTAP 기반). 트랜잭션 안에서만 돌고 rollback 으로 흔적을 남기지 않는다.

begin;
select plan(5);

-- 픽스처: 검증용 원문 1건. (트리거는 INSERT 에는 관여하지 않는다.)
insert into raw_entries (id, user_id, source, transcript)
values (
  '00000000-0000-0000-0000-0000000000aa',
  '00000000-0000-0000-0000-0000000000b0',
  'text',
  '원문 그대로'
);

-- 1) transcript 를 바꾸는 UPDATE → 실패해야 한다.
select throws_ok(
  $$ update raw_entries set transcript = '변조됨'
       where id = '00000000-0000-0000-0000-0000000000aa' $$,
  NULL, NULL,
  'transcript 를 바꾸는 UPDATE 는 트리거에 의해 거부되어야 한다'
);

-- 2) parse_version / parsed_at 만 바꾸는 UPDATE → 성공해야 한다. (재파싱 경로)
select lives_ok(
  $$ update raw_entries
       set parse_version = 'v1', parsed_at = now(), parse_error = null
       where id = '00000000-0000-0000-0000-0000000000aa' $$,
  'parse 메타(parse_version/parsed_at/parse_error)만 바꾸는 UPDATE 는 허용되어야 한다'
);

-- 3) DELETE → 실패해야 한다.
select throws_ok(
  $$ delete from raw_entries
       where id = '00000000-0000-0000-0000-0000000000aa' $$,
  NULL, NULL,
  'raw_entries DELETE 는 트리거에 의해 거부되어야 한다'
);

-- 4) id 를 바꾸는 UPDATE → 실패해야 한다. (허용목록 밖 컬럼)
select throws_ok(
  $$ update raw_entries set id = '00000000-0000-0000-0000-0000000000cc'
       where id = '00000000-0000-0000-0000-0000000000aa' $$,
  NULL, NULL,
  'id 를 바꾸는 UPDATE 는 트리거에 의해 거부되어야 한다'
);

-- 5) created_at 을 바꾸는 UPDATE → 실패해야 한다. (허용목록 밖 컬럼)
select throws_ok(
  $$ update raw_entries set created_at = now() - interval '1 day'
       where id = '00000000-0000-0000-0000-0000000000aa' $$,
  NULL, NULL,
  'created_at 을 바꾸는 UPDATE 는 트리거에 의해 거부되어야 한다'
);

select * from finish();
rollback;
