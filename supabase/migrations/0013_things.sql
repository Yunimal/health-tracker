-- things: 여러 시점에 걸쳐 추적할 고유 대상.
-- thing_mentions: events / hypothesis_mentions 와 같은 생명주기의 파생 데이터.
--
-- 재파싱 멱등성: unique(thing_id, raw_entry_id) — 한 원문은 한 대상에 한 번만.
-- 재파싱 시 그 raw_entry 의 mention 만 지웠다 다시 넣는다 (persist.ts persistThings).
--
-- mention_count / first_seen_at / last_seen_at 는 비정규화 캐시.
-- source of truth 는 thing_mentions. recountThing() 이 동기를 유지한다.

create table things (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null,
  kind           text not null check (kind in ('treatment', 'product', 'place', 'regimen')),
  name           text not null,
  aliases        text[] not null default '{}',
  first_seen_at  timestamptz,
  last_seen_at   timestamptz,
  mention_count  int not null default 0,
  note           text,           -- 사용자가 직접 쓰는 메모. 파생 데이터가 아니다.
  created_at     timestamptz not null default now()
);

create index things_user_id_idx on things (user_id);

create table thing_mentions (
  id           uuid primary key default gen_random_uuid(),
  thing_id     uuid not null references things(id) on delete cascade,
  raw_entry_id uuid not null references raw_entries(id) on delete cascade,
  user_id      uuid not null,
  excerpt      text,             -- 원문에서 이 대상을 언급한 부분(원문 그대로)
  created_at   timestamptz not null default now(),
  unique (thing_id, raw_entry_id)
);

create index thing_mentions_thing_id_idx on thing_mentions (thing_id);
create index thing_mentions_raw_entry_id_idx on thing_mentions (raw_entry_id);

-- 건강정보는 민감정보다. 다른 파생 테이블과 동일하게 RLS + user_id 정책. (0003 패턴)
alter table things enable row level security;
create policy things_all_own on things
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table thing_mentions enable row level security;
create policy thing_mentions_all_own on thing_mentions
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
