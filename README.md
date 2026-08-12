# Health Tracker

음성 기반 개인 헬스 트래커 (Phase 0). 말한 그대로 던지면 알아서 분류해 저장하고,
쌓인 데이터로 "나 사용 설명서"를 만든다.

- 스펙 원본: [`기획서.md`](./기획서.md)
- 작업 원칙 / 절대 규칙: [`CLAUDE.md`](./CLAUDE.md)

## 스택

Next.js 15 (App Router) · TypeScript(strict) · Supabase(Postgres, RLS) ·
Anthropic SDK · vitest · pnpm

## 로컬 실행

### 1. 요구 사항

- Node.js 20+ (개발은 24에서 진행)
- pnpm 11+
- Supabase 프로젝트 (또는 로컬 Supabase)

### 2. 설치

```bash
pnpm install
```

### 3. 환경 변수

`.env.example` 을 복사해 `.env.local` 을 만들고 값을 채운다.

```bash
cp .env.example .env.local
```

| 변수                        | 설명                                                  |
| --------------------------- | ----------------------------------------------------- |
| `SUPABASE_URL`              | Supabase 프로젝트 URL                                 |
| `SUPABASE_SERVICE_ROLE_KEY` | 서버 전용 service role key (RLS 우회, 절대 노출 금지) |
| `ANTHROPIC_API_KEY`         | Claude API 키                                         |
| `PARSE_MODEL` (선택)        | 파싱 모델. 미설정 시 `claude-sonnet-5`                |

> 사용자 식별은 환경 변수가 아니라 `app_users.ingest_token`(DB) 으로 한다. 각 구성원의
> 토큰은 `app_users` 행에 저장한다(0006 마이그레이션). `USER_ID` / `INGEST_TOKEN` 환경
> 변수는 폐기됐다. ⚠️ 토큰을 아는 사람은 그 사용자의 기록을 볼 수 있다 — 가족끼리만 공유.

iOS 단축어(음성 입력) 연동은 [`docs/shortcut-setup.md`](./docs/shortcut-setup.md) 참고.

### 4. DB 마이그레이션

`supabase/migrations/0001_init.sql` 을 Supabase 에 적용한다. (Supabase CLI 또는
대시보드 SQL 에디터)

```bash
# Supabase CLI 사용 시
supabase db push
```

### 5. 개발 서버

```bash
pnpm dev
# http://localhost:3000
```

## 명령어

| 명령어             | 설명                                     |
| ------------------ | ---------------------------------------- |
| `pnpm dev`         | 개발 서버                                |
| `pnpm build`       | 프로덕션 빌드                            |
| `pnpm typecheck`   | 타입 검사 (`tsc --noEmit`)               |
| `pnpm lint`        | ESLint                                   |
| `pnpm format`      | Prettier 포매팅                          |
| `pnpm test`        | 전체 테스트                              |
| `pnpm test:golden` | 골든 회귀 테스트 (프롬프트 수정 시 필수) |

## API (Phase 0)

- `POST /api/entries` — 원문 수신. iOS 단축어가 `{ transcript, recorded_at, source }`
  를 보내면 `raw_entries` 에 저장하고 즉시 200. (파싱은 비동기)
- `POST /api/parse` — 파싱 트리거. raw_entry 를 파싱해 `events` / `hypotheses` 생성.

> 두 엔드포인트는 현재 스텁(501)이다. 구현은 후속 STEP 에서 진행한다.

## 현재 상태

프로젝트 뼈대만 존재한다. 구현 예정:

- STEP 2 — `/api/entries` + Supabase 클라이언트 + 원문 저장
- STEP 3 — LLM 파싱 파이프라인 + 골든셋 채우기
- STEP 4 — 타임라인 웹 뷰 + 교정 UI
