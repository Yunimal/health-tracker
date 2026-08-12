# CLAUDE.md

음성 기반 개인 헬스 트래커. **유일한 스펙 원본은 루트의 `기획서.md` 이다.** 이 문서와
기획서가 충돌하면 기획서를 따르고, 이 문서를 고친다.

현재 단계: **Phase 0 (자체 사용 검증)** — 단축어 + API + DB + 원문 저장.

## 절대 원칙 (위반 금지)

1. **`raw_entries.transcript` 는 절대 UPDATE/DELETE 하지 않는다.** 원문은 불변이며
   영구 보존한다. 파싱이 틀렸어도 원문은 그대로 두고 파생 데이터만 다시 만든다.
   - `raw_entries_prevent_mutation()` 함수는 0002 에서 정의되고 0004 에서 create or replace 로
     교체됐다. 현재 허용 컬럼 목록을 확인하려면 가장 최근 마이그레이션을 봐야 한다. 앞으로
     이 함수를 또 바꾸면 이 줄의 파일 번호도 갱신할 것.
2. **파싱 결과(`events`, `hypotheses`)는 언제든 삭제하고 재생성 가능한 파생 데이터다.**
   재파싱은 기존 파생 데이터를 지우고 다시 INSERT 하는 방식으로 한다.
3. **LLM 이 수치를 추론해서 지어내지 않는다. 모르면 `null`.** "세 모금"을 90ml 로
   확정하지 말고 `amount_text` 에 원문을 남기고 `amount_value` 는 `null` 로 둔다.
4. **사용자의 추측은 event 가 아니라 hypothesis 다.** "~인가?", "~때문인지 모르겠어",
   "~해서 그런가" 같은 표현은 사실 이벤트로 저장하지 않고 `hypotheses` 로 분리한다.
   (가설/사실 오분류는 골든셋의 **가장 중요한 지표**다.)
5. **프롬프트 수정 시 반드시 골든 테스트를 돌린다.** (`pnpm test:golden`) 프롬프트는
   `src/lib/parser/prompts/vN.md` 로 버전을 올리고, 사용한 버전을
   `raw_entries.parse_version` 에 기록한다.
   - **프롬프트의 실제 원본은 `src/lib/parser/prompts/v1.ts`(`PROMPT_V1`)다.**
     파서는 이 문자열 상수를 사용한다(번들 안전 — fs 접근 없음). **`v1.md` 는 사람이
     읽는 참조용 사본이며, 이를 고쳐도 동작에 반영되지 않는다.**
   - **프롬프트 파일을 고치지 말고 새 버전 파일을 만든다.** `v1.ts` 를 직접 수정하지
     않는다 — `v2.ts` 를 새로 만들어 `src/lib/parser/index.ts` 의 `PROMPTS` 레지스트리에
     등록하고 `PARSE_VERSION` 을 `"v2"` 로 올린다(참조용 `v2.md` 도 함께 갱신). 과거
     원문은 배치 재파싱(`POST /api/parse` `{ batch: true }`)으로 새 버전에 맞춰 다시 만든다.
   - **파싱 규칙의 유일한 원본은 `tests/golden/RULES.md`(R1~R12)다.** 프롬프트와
     골든셋은 항상 같은 규칙을 따른다. 규칙을 바꾸면 RULES.md → 프롬프트 → 골든셋
     순서로 함께 갱신한다.
   - **LLM 은 `confidence`/`needs_review` 를 출력하지 않는다.** 사실만 뽑고,
     confidence 는 `src/lib/parser/confidence.ts` 가 R6 로 계산한다. (골든 테스트가
     산수가 아니라 파싱 품질을 재도록.)

## 스택 (고정 — 변경 금지)

- Next.js 15 App Router + TypeScript (strict)
- Supabase (Postgres, RLS)
- Anthropic SDK (`@anthropic-ai/sdk`) — structured output 으로 JSON 강제
- 파싱 모델: 기본 `claude-sonnet-5` (env `PARSE_MODEL` 로 오버라이드). v6 골든셋에서
  Opus 4.8 과 동일한 41/41 만점(오분류 0)인데 비용이 낮아 기본값으로 채택. 환경변수를
  깜빡해도 비싼 모델로 떨어지지 않도록 기본값 자체를 Sonnet 으로 둔다.
- 테스트: vitest
- 패키지 매니저: pnpm

## 구조

```
src/app/api/entries/route.ts   원문 수신 (POST → raw_entries INSERT, 즉시 200, 파싱은 비동기)
src/app/api/parse/route.ts     파싱 트리거 (raw_entry → events/hypotheses/unparsed 재생성)
src/lib/db/                    Supabase 클라이언트 + DB 행 타입
src/lib/parser/                LLM 파싱 로직 + confidence 계산(R6)
src/lib/parser/prompts/vN.ts   버전별 프롬프트 원본(문자열 상수). vN.md 는 참조용 사본
supabase/migrations/           DB 스키마 (0001 스키마 · 0002 원문불변 트리거 · 0003 unparsed ·
                               0004 hidden_at · 0005 카테고리 확장 · 0006 다중 사용자)
src/lib/auth.ts                토큰 → 사용자 해석 (API: Bearer, 웹: httpOnly 쿠키)
src/app/login/                 토큰 붙여넣기 로그인 페이지
tests/golden/                  골든 테스트셋 (case-*.json + 러너)
```

## 데이터 모델 요약 (상세는 기획서 §5)

- `raw_entries` — 원문. 불변.
- `events` — 파싱된 사실. 카테고리는 `food | mood | sleep | energy | menstrual | bowel |
medication` 7개 (0005 로 확장). payload 스키마는 기획서 §5.3 및 RULES R11/R14~R16.
- `hypotheses` — 사용자가 스스로 던진 추측. `status: open|supported|not_supported|dismissed`.
- `unparsed_fragments` — 4개 카테고리로 못 담은 건강 신호 원문. events 와 같은 생명주기의
  파생 데이터(재파싱 시 삭제·재생성). Phase 2 재파싱 재료.

## 다중 사용자 / 보안 (0006 이후)

- **가족 3명 규모.** Supabase Auth 는 도입하지 않는다(과한 구조). 사용자는 `app_users`
  테이블의 `ingest_token` 으로 식별한다. `USER_ID` / `INGEST_TOKEN` 환경 변수는 폐기.
- **시드는 마이그레이션에 넣지 않는다.** `0006` 은 테이블+RLS 만 만든다(커밋되는 파일에
  토큰을 남기지 않으려고). 사용자 행은 SQL Editor 에서 수동 추가 — `docs/multi-user-setup.md`.
- 인증 경로(@/lib/auth):
  - API(`/api/entries`, `/api/parse`) — `Authorization: Bearer <ingest_token>`.
  - 웹(페이지·서버 액션) — httpOnly 쿠키(`ht_token`)의 토큰. `/login` 에서 붙여넣어 저장,
    로그아웃으로 삭제. 우측 상단에 현재 `label` 표시.
  - 토큰→사용자 조회는 60초 메모리 캐시(매 요청 DB 조회 방지).
- ⚠️ **이건 진짜 보안 경계가 아니다.** 토큰을 아는 사람은 그 사용자의 기록을 볼 수 있다.
  **가족 3명 + 전원 동의**를 전제로만 쓰는 구조다. 타이밍-세이프 비교·레이트리밋·토큰
  회전 같은 방어는 없다. **외부(비가족) 공개 배포로 확장할 때는 이 모델을 폐기하고
  실제 인증(Supabase Auth 등)으로 교체해야 한다.**

## Phase 0 제약

- UI 컴포넌트, 파싱 로직 구현은 각 STEP 에서 점진적으로 만든다.
- 항목은 초기 4개(food/mood/sleep/energy)에서 시작해 menstrual/bowel/medication 를
  추가(0005). 나머지(몸무게·혈압·혈당 등)는 이후 단계.

## 명령어

```bash
pnpm dev            # 개발 서버
pnpm typecheck      # tsc --noEmit
pnpm lint           # next lint
pnpm test           # 전체 테스트
pnpm test:golden    # 골든 회귀 테스트 (프롬프트 수정 시 필수)
```
