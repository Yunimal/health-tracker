-- 사용자가 "다름"으로 거부한 병합 후보 쌍을 기억한다.
-- 한 번 "다름"을 누른 쌍은 다시 후보로 뜨지 않는다.
--
-- 쌍은 항상 thing_a_id < thing_b_id (uuid 문자열 비교)로 저장한다.
-- 순서 무관한 unique 제약을 앱 레벨 정규화로 보장한다.
-- on delete cascade: 어느 한 쪽이 병합으로 삭제되면 거부 기록도 사라진다.

create table thing_merge_rejections (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,
  thing_a_id uuid not null references things(id) on delete cascade,
  thing_b_id uuid not null references things(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, thing_a_id, thing_b_id),
  check (thing_a_id < thing_b_id)
);

create index thing_merge_rejections_user_id_idx on thing_merge_rejections (user_id);

alter table thing_merge_rejections enable row level security;
create policy thing_merge_rejections_all_own on thing_merge_rejections
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
