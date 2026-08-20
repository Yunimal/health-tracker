-- 카테고리 확장: appetite(식욕·공복감) / digestion(소화 감각) 추가 → 10개. (RULES R20/R21, DRAFT5)
-- 0007 에서 교체한 events_category_check 를 다시 교체한다. (기존 마이그레이션 파일은 수정하지 않는다)
-- payload 스키마는 애플리케이션(zod)에서 검증하므로 DB 는 jsonb 그대로 둔다.

alter table events
  drop constraint events_category_check,
  add constraint events_category_check
    check (category in
      ('food', 'mood', 'sleep', 'energy', 'menstrual', 'bowel', 'medication', 'activity',
       'appetite', 'digestion'));
