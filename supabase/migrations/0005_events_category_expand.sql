-- 카테고리 확장: menstrual / bowel / medication 추가. (RULES R14~R16)
-- 0001 의 events.category CHECK 는 인라인이라 constraint 이름이 events_category_check 로
-- 자동 생성된다. 그 제약을 교체한다. (0001~0004 파일은 수정하지 않는다)

alter table events
  drop constraint events_category_check,
  add constraint events_category_check
    check (category in ('food', 'mood', 'sleep', 'energy', 'menstrual', 'bowel', 'medication'));
