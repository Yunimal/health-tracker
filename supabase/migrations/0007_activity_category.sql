-- 카테고리 확장: activity(운동·신체활동) 추가 → 8개. (RULES R18)
-- 0005 에서 교체한 events_category_check 를 다시 교체한다. (0001~0006 파일은 수정하지 않는다)
-- payload 스키마는 애플리케이션(zod)에서 검증하므로 DB 는 jsonb 그대로 둔다.

alter table events
  drop constraint events_category_check,
  add constraint events_category_check
    check (category in
      ('food', 'mood', 'sleep', 'energy', 'menstrual', 'bowel', 'medication', 'activity'));
