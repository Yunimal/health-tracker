-- 성찰 기록(reflections)과 그 응답(reflection_replies). (기능 A)
--
-- reflections: "폰 습관 vs 잡념, 뭐가 나은지 고민중" 같은 생각·자기관찰 문장. 사건(events)이
--   아니라 생각이라 unparsed 로 버려지던 것을 별도로 보존한다. **파생 데이터**다 — events /
--   unparsed_fragments 와 같은 생명주기(재파싱 시 DELETE 후 재삽입). (0003 패턴)
--
-- reflection_replies: "같이 생각해보기"로 사용자가 요청했을 때만 LLM 이 만든 응답. **파생 데이터가
--   아니다.** 재파싱해도 지우지 않는다 — 사용자가 읽은 내용이 사라지면 안 된다. reflections 는
--   재생성되어 id 가 바뀌므로, reflection id 대신 (raw_entry_id, reflection_text)로 느슨히 잇는다.

create table reflections (
  id           uuid primary key default gen_random_uuid(),
  raw_entry_id uuid not null references raw_entries(id) on delete cascade,
  user_id      uuid not null,
  text         text not null,
  created_at   timestamptz not null default now()
);

create index on reflections (user_id, created_at desc);
create index on reflections (raw_entry_id);

alter table reflections enable row level security;
create policy reflections_all_own on reflections
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table reflection_replies (
  id              uuid primary key default gen_random_uuid(),
  raw_entry_id    uuid not null references raw_entries(id) on delete cascade,
  user_id         uuid not null,
  reflection_text text not null, -- 어떤 성찰에 대한 응답인지 (재파싱 후에도 매칭용)
  reply           text not null,
  created_at      timestamptz not null default now()
);

create index on reflection_replies (raw_entry_id);

alter table reflection_replies enable row level security;
create policy reflection_replies_all_own on reflection_replies
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
