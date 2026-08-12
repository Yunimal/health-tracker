# 다중 사용자 시드 절차 (app_users)

`0006_multi_user.sql` 은 **테이블 생성과 RLS 만** 한다. 사용자 행(토큰 포함)은 여기서
만들지 않는다 — 마이그레이션은 git 에 커밋되므로 토큰이 이력에 영구히 남기 때문이다.

사용자 추가는 아래 순서로 **Supabase SQL Editor 에서 수동 실행**한다.

> 🚨 **이 문서에 실제 토큰을 적지 마라.** 이 파일도 git 에 커밋된다. 아래 `<...>` 는 전부
> 플레이스홀더다. 실제 토큰은 SQL Editor 에 붙여넣는 순간에만 존재해야 하고, 각자에게는
> 안전한 경로(비밀번호 관리자 등)로 전달한다.
>
> ⚠️ 이건 진짜 보안 경계가 아니다. 토큰을 아는 사람은 그 사용자의 기록을 볼 수 있다.
> 가족 3명 + 전원 동의 전제에서만 쓴다. (CLAUDE.md "다중 사용자 / 보안" 참고)

---

## 1. 사람 수만큼 토큰 생성

한 명당 하나씩, 길고 무작위한 값으로 만든다. 터미널에서:

```bash
# 3명이면 3번 실행 (각 줄이 한 사람의 토큰)
openssl rand -hex 32
openssl rand -hex 32
openssl rand -hex 32
```

각 출력값을 누구 것인지 메모해 둔다(예: 나 / 엄마 / 동생). 이 값이 곧 그 사람의
`ingest_token` 이다 — 웹 `/login` 과 iOS 단축어 양쪽에 같은 값을 넣는다.

---

## 2. 기존 사용자('나')는 기존 user_id 를 유지

이미 원문(`raw_entries`)이 쌓여 있다면, 그 데이터의 `user_id` 를 '나' 행의 `id` 로
그대로 재사용해야 기존 기록에 계속 접근할 수 있다. 먼저 현재 user_id 를 확인한다:

```sql
select distinct user_id from raw_entries;
```

보통 한 개(과거 단일 사용자 UUID)가 나온다. 그 값을 '나' 행의 `id` 로 넣는다:

```sql
-- <기존_user_id> : 위 select 결과. <나의_토큰> : 1번에서 만든 토큰.
insert into app_users (id, label, ingest_token)
values ('<기존_user_id>', '나', '<나의_토큰>');
```

> 원문이 아직 없는 신규 설치라면 `id` 를 지정하지 말고 기본값(gen_random_uuid)에 맡긴다:
>
> ```sql
> insert into app_users (label, ingest_token) values ('나', '<나의_토큰>');
> ```

---

## 3. 나머지 가족 추가

새 구성원은 `id` 를 지정하지 않는다(자동 생성). 각자 고유 토큰을 넣는다:

```sql
insert into app_users (label, ingest_token) values ('엄마', '<엄마_토큰>');
insert into app_users (label, ingest_token) values ('동생', '<동생_토큰>');
```

---

## 4. 확인

토큰 자체는 출력하지 말고 존재만 확인한다:

```sql
select id, label, created_at from app_users order by created_at;
```

세 사람이 보이면 완료. 각자에게 본인 토큰을 안전하게 전달하고:

- **웹**: `/login` 에서 토큰을 붙여넣어 로그인 (httpOnly 쿠키에 저장됨).
- **iOS 단축어**: `Authorization: Bearer <본인_토큰>` 로 설정 (docs/shortcut-setup.md).

---

## 토큰 회전(분실·유출 시)

해당 사용자의 토큰만 새로 만들어 교체한다. `id` 는 그대로 두므로 기존 기록은 유지된다:

```sql
update app_users set ingest_token = '<새_토큰>' where label = '나';
```

> 서버는 토큰→사용자 조회를 60초 캐시한다. 교체 후 최대 1분간 이전 토큰이 통할 수 있다.
