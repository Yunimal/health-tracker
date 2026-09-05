-- raw_entries.source CHECK 에 'device' 를 추가한다.
-- /api/sleep 이 워치 측정 요약을 source='device' 로 저장하기 위해 필요하다.
-- 기존 CHECK 를 제거하고 새 값을 포함한 CHECK 를 붙인다.

alter table raw_entries
  drop constraint if exists raw_entries_source_check;

alter table raw_entries
  add constraint raw_entries_source_check
    check (source in ('voice', 'text', 'device'));
