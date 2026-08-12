-- 파싱이 4개 카테고리로 담지 못한 건강 신호 조각을 보존한다. (RULES R2)
-- events 와 동일하게 재생성 가능한 파생 데이터다: 재파싱 시 DELETE 후 재삽입.
-- Phase 2 에서 카테고리를 추가한 뒤 재파싱으로 되살리기 위한 원본 재료.

create table unparsed_fragments (
  id           uuid primary key default gen_random_uuid(),
  raw_entry_id uuid not null references raw_entries(id) on delete cascade,
  user_id      uuid not null,
  text         text not null,
  created_at   timestamptz not null default now()
);

create index on unparsed_fragments (user_id, created_at desc);

-- events 와 동일한 소유자 정책. 파생 데이터이므로 소유자에게 전체 CRUD 허용.
alter table unparsed_fragments enable row level security;

create policy unparsed_fragments_all_own on unparsed_fragments
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
