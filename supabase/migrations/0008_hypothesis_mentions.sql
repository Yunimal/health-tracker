-- 가설 의미 병합. 같은 의심을 다르게 표현해도 한 canonical 가설 행에 모으고, 그 의심을
-- 표현한 서로 다른 원문(raw_entry)을 mention 으로 링크한다.
--
-- mention_count 의 의미를 재정의한다: "이 의심을 표현한 서로 다른 raw_entry 수" = mention 행 수.
-- (hypothesis_mentions 가 source of truth, mention_count 는 비정규화 카운터)
-- unique(hypothesis_id, raw_entry_id): 한 원문은 한 의심에 한 번만 → 재파싱해도 중복 카운트 불가.
--
-- 파생 데이터다(events 와 같은 생명주기): 재파싱 시 해당 원문의 mention 만 지웠다 다시 넣는다.

alter table hypotheses add column recent_statement text; -- 가장 최근 표현. statement 는 최초 표현 유지.

create table hypothesis_mentions (
  id            uuid primary key default gen_random_uuid(),
  hypothesis_id uuid not null references hypotheses(id) on delete cascade,
  raw_entry_id  uuid not null references raw_entries(id) on delete cascade,
  user_id       uuid not null,
  statement     text,                                -- 그 원문에서의 표현(이력)
  created_at    timestamptz not null default now(),
  unique (hypothesis_id, raw_entry_id)
);

create index hypothesis_mentions_hypothesis_id_idx on hypothesis_mentions (hypothesis_id);
create index hypothesis_mentions_raw_entry_id_idx on hypothesis_mentions (raw_entry_id);

-- 건강정보는 민감정보다. 다른 파생 테이블과 동일하게 RLS + user_id 정책. (0003 패턴)
alter table hypothesis_mentions enable row level security;
create policy hypothesis_mentions_all_own on hypothesis_mentions
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── 백필: 기존 가설마다 mention 1건(가리키는 원문이 있을 때) + recent_statement 초기화 ──
insert into hypothesis_mentions (hypothesis_id, raw_entry_id, user_id, statement, created_at)
select id, raw_entry_id, user_id, statement, created_at
from hypotheses
where raw_entry_id is not null
on conflict (hypothesis_id, raw_entry_id) do nothing;

update hypotheses set recent_statement = statement where recent_statement is null;

-- mention_count 를 실제 mention 수에 맞춘다. 원문 링크가 없는 레거시 행은 표시를 위해 최소 1.
update hypotheses h
set mention_count = greatest(1, (
  select count(*) from hypothesis_mentions m where m.hypothesis_id = h.id
));
