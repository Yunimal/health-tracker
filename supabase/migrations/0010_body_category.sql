-- 카테고리 확장: body_condition(신체 부위 상태·관찰) / body_care(관리 행위) 추가 → 12개. (RULES R23/R24, DRAFT6)
-- 0009 에서 교체한 events_category_check 를 다시 교체한다. (기존 마이그레이션 파일은 수정하지 않는다)
-- payload 스키마는 애플리케이션(zod)에서 검증하므로 DB 는 jsonb 그대로 둔다.
--
-- ⚠️ 순서 주의: 이 마이그레이션을 **먼저 적용한 뒤** 배치 재파싱(POST /api/parse {batch:true})을 한다.
--    CHECK 확장 전에 v10 으로 재파싱하면 새 카테고리 INSERT 가 제약 위반으로 실패하고, reparseEntry
--    는 비원자적이라 기존 events 가 지워진 채 남는다(원문은 보존). (CLAUDE.md 원칙 2)

alter table events
  drop constraint events_category_check,
  add constraint events_category_check
    check (category in
      ('food', 'mood', 'sleep', 'energy', 'menstrual', 'bowel', 'medication', 'activity',
       'appetite', 'digestion', 'body_condition', 'body_care'));
