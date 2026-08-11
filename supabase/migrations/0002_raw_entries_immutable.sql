-- 원문 불변 강제. (기획서 §5.1 원칙 1: "원문은 불변이며 영구 보존한다.")
--
-- 0001_init.sql 의 RLS 정책은 raw_entries 에 UPDATE/DELETE 를 열어두지 않지만,
-- RLS 는 service role(및 table owner)에게는 적용되지 않는다. Phase 0 의 API 는
-- service role key 로 접속하므로 RLS 만으로는 원문 변조를 막을 수 없다.
-- 따라서 모든 역할에 적용되는 트리거로 강제한다.

create or replace function raw_entries_prevent_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception
      '기획서 §5.1: 원문은 불변이며 영구 보존한다. raw_entries 는 삭제할 수 없다.'
      using errcode = 'check_violation';
  end if;

  -- UPDATE: 허용목록 방식. parse_version/parsed_at/parse_error 세 컬럼을 제외한
  -- 나머지 전체(=원문)가 하나라도 바뀌면 거부한다. 금지 컬럼을 나열하지 않으므로
  -- 나중에 raw_entries 에 컬럼이 추가돼도 트리거를 고칠 필요 없이 자동 보호된다.
  if (to_jsonb(new) - 'parse_version' - 'parsed_at' - 'parse_error')
       is distinct from
     (to_jsonb(old) - 'parse_version' - 'parsed_at' - 'parse_error')
  then
    raise exception
      '기획서 §5.1: 원문은 불변이며 영구 보존한다. raw_entries 는 parse_version/parsed_at/parse_error 외의 컬럼을 수정할 수 없다.'
      using errcode = 'check_violation';
  end if;

  -- parse_version / parsed_at / parse_error 만 바뀌는 UPDATE 는 허용한다.
  -- (STEP 3 의 재파싱이 이 경로를 쓴다.)
  return new;
end;
$$;

drop trigger if exists raw_entries_immutable on raw_entries;

create trigger raw_entries_immutable
  before update or delete on raw_entries
  for each row
  execute function raw_entries_prevent_mutation();
