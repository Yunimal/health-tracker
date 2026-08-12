-- 원문 소프트 삭제(숨김). 완전 삭제(DELETE)는 0002 트리거로 계속 막는다.
-- hidden_at 은 원문 "내용"이 아니라 메타데이터이므로 트리거 허용목록에 추가한다.
-- transcript / recorded_at / source / audio_path 등 원문 필드는 계속 불변으로 막혀 있다.

alter table raw_entries add column hidden_at timestamptz;

create index on raw_entries (user_id, hidden_at);

-- 0002 의 트리거 함수를 교체한다(0002 파일은 수정하지 않는다). 허용목록에 hidden_at 추가:
-- parse_version / parsed_at / parse_error / hidden_at 만 UPDATE 허용.
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

  if (to_jsonb(new) - 'parse_version' - 'parsed_at' - 'parse_error' - 'hidden_at')
       is distinct from
     (to_jsonb(old) - 'parse_version' - 'parsed_at' - 'parse_error' - 'hidden_at')
  then
    raise exception
      '기획서 §5.1: 원문은 불변이며 영구 보존한다. raw_entries 는 parse_version/parsed_at/parse_error/hidden_at 외의 컬럼을 수정할 수 없다.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- 트리거 raw_entries_immutable(0002)은 이 함수를 가리키므로 재생성 불필요.
