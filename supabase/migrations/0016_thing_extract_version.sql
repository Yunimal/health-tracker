-- 대상 추출 버전 관리.
--
-- 파싱(parse_version)과 대상 추출(thing_extract_version)은 별개의 버전 체계를 가진다.
-- 추출 프롬프트만 고쳤을 때 전체 재파싱 없이 추출만 다시 실행할 수 있도록 한다.
-- (pnpm extract-things — thing_extract_version 이 현재 값과 다른 원문만 대상)
--
-- 0002/0004 트리거 허용목록에도 추가한다.
-- parse_version / parsed_at / parse_error / hidden_at / thing_extract_version 만 UPDATE 허용.

alter table raw_entries add column thing_extract_version text;

-- 0004 의 트리거 함수를 교체한다(0004 파일은 수정하지 않는다).
-- 허용목록에 thing_extract_version 추가.
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
        - 'thing_extract_version')
       is distinct from
     (to_jsonb(old)
        - 'parse_version' - 'parsed_at' - 'parse_error'
        - 'hidden_at'
        - 'thing_extract_version')
  then
    raise exception
      '기획서 §5.1: 원문은 불변이며 영구 보존한다. raw_entries 는 parse_version/parsed_at/parse_error/hidden_at/thing_extract_version 외의 컬럼을 수정할 수 없다.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- 트리거 raw_entries_immutable(0002)은 이 함수를 가리키므로 재생성 불필요.
