-- thing_blocklist: 사용자가 삭제한 대상의 종류+정규화 이름을 기록한다.
--
-- ⚠️ 파생 데이터가 아니다 — 재파싱과 무관하게 영구 적용된다.
-- 병합·삭제·이름수정은 사용자가 직접 한 행위이므로 재파싱으로 되돌아가지 않는다.
--
-- persistThings 가 LLM 추출 결과를 저장하기 전에 이 목록을 확인하고,
-- 등록된 항목은 건너뛴다. 한 번 삭제된 대상은 재파싱해도 다시 올라오지 않는다.
--
-- normalized_name: thing-extract.ts normalize() 와 동일한 규칙으로 저장한다.
-- 삭제 시 이름 + 모든 aliases 의 정규화 값을 함께 등록한다.

create table thing_blocklist (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null,
  kind            text not null check (kind in ('treatment', 'product', 'place', 'regimen')),
  normalized_name text not null,
  created_at      timestamptz not null default now(),
  unique (user_id, kind, normalized_name)
);

create index thing_blocklist_user_id_idx on thing_blocklist (user_id);

alter table thing_blocklist enable row level security;
create policy thing_blocklist_all_own on thing_blocklist
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
