-- 기획서 §5.2 스키마. 원본은 기획서.md 이며 이 파일은 그 반영이다.
-- 원칙: raw_entries.transcript 는 불변/영구 보존. events/hypotheses 는 재생성 가능한 파생 데이터.

-- 원문. 절대 수정하지 않는다.
create table raw_entries (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null,
  recorded_at   timestamptz not null default now(),  -- 사용자가 말한 시각
  source        text not null check (source in ('voice','text')),
  transcript    text not null,
  audio_path    text,
  parse_version text,        -- 어떤 프롬프트 버전으로 파싱했는지
  parsed_at     timestamptz,
  parse_error   text,
  created_at    timestamptz not null default now()
);

-- 파싱된 사실 이벤트. 재생성 가능.
create table events (
  id                     uuid primary key default gen_random_uuid(),
  raw_entry_id           uuid not null references raw_entries(id) on delete cascade,
  user_id                uuid not null,
  category               text not null check (category in ('food','mood','sleep','energy')),
  occurred_at            timestamptz not null,
  occurred_at_precision  text not null
    check (occurred_at_precision in ('exact','hour','part_of_day','date')),
  payload                jsonb not null,
  confidence             numeric(3,2) not null default 1.00,
  needs_review           boolean not null default false,
  corrected_by_user      boolean not null default false,
  created_at             timestamptz not null default now()
);

create index on events (user_id, occurred_at desc);
create index on events (user_id, category, occurred_at desc);

-- 사용자가 발화 중에 스스로 던진 추측.
create table hypotheses (
  id             uuid primary key default gen_random_uuid(),
  raw_entry_id   uuid references raw_entries(id) on delete set null,
  user_id        uuid not null,
  statement      text not null,          -- 원문 그대로의 추측
  cause_hint     text,                   -- "멜라토닌 미복용"
  effect_hint    text,                   -- "수면 질 저하"
  mention_count  int not null default 1, -- 같은 의심을 몇 번 했는지
  status         text not null default 'open'
    check (status in ('open','supported','not_supported','dismissed')),
  created_at     timestamptz not null default now()
);

-- 건강정보는 민감정보다. 세 테이블 모두 RLS 를 켜고 user_id 기반 정책을 둔다. (기획서 §10)
-- Phase 0 은 인증이 없어 service role key(RLS 우회)로 접근하지만, 정책은 미리 심어
-- 인증 도입 시 곧바로 사용자별 격리가 되도록 한다.
alter table raw_entries enable row level security;
alter table events      enable row level security;
alter table hypotheses  enable row level security;

-- raw_entries: 원문은 불변이다. 소유자에게 SELECT/INSERT 만 허용하고
-- UPDATE/DELETE 정책은 두지 않아 원문 변경을 DB 차원에서 막는다. (기획서 §5.1 원칙 1)
create policy raw_entries_select_own on raw_entries
  for select to authenticated using (auth.uid() = user_id);
create policy raw_entries_insert_own on raw_entries
  for insert to authenticated with check (auth.uid() = user_id);

-- events: 파싱 결과는 재생성 가능한 파생 데이터. 소유자에게 전체 CRUD 허용.
create policy events_all_own on events
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- hypotheses: 소유자에게 전체 CRUD 허용.
create policy hypotheses_all_own on hypotheses
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
