-- 대상 추출 실패 사유 기록.
--
-- parse_error 와 같은 방식으로 thing_extract_error 에 기록한다.
-- extract-things 실패 시 원문은 건드리지 않고 thing_extract_error 만 갱신한다.
-- 성공 시에는 thing_extract_error 를 null 로 초기화한다(이전 실패 기록 제거).
--
-- 0016 트리거 허용목록에도 추가한다.
-- 허용 컬럼: parse_version / parsed_at / parse_error / hidden_at /
--            thing_extract_version / thing_extract_error

alter table raw_entries add column thing_extract_error text;

-- 0016 의 트리거 함수를 교체한다(0016 파일은 수정하지 않는다).
-- 허용목록에 thing_extract_error 추가.
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

  if (to_jsonb(new)
        - 'parse_version' - 'parsed_at' - 'parse_error'
        - 'hidden_at'
        - 'thing_extract_version'
        - 'thing_extract_error')
       is distinct from
     (to_jsonb(old)
        - 'parse_version' - 'parsed_at' - 'parse_error'
        - 'hidden_at'
        - 'thing_extract_version'
        - 'thing_extract_error')
  then
    raise exception
      '기획서 §5.1: 원문은 불변이며 영구 보존한다. raw_entries 는 parse_version/parsed_at/parse_error/hidden_at/thing_extract_version/thing_extract_error 외의 컬럼을 수정할 수 없다.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- 트리거 raw_entries_immutable(0002)은 이 함수를 가리키므로 재생성 불필요.
