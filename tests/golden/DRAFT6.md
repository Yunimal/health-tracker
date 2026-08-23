# 골든셋 DRAFT6 — body_condition / body_care 카테고리 (case-041~050)

**개수를 늘리는 대신 부위(part)를 필드로 뺀다.** 두피·모발·피부·질·손발톱·구강·눈·성욕
같은 신체 부위 신호를 카테고리마다 하나씩 만들지 않고, `part` enum 으로 담아 확장성을
확보한다. 상태(관찰)와 관리(행위)는 섞지 않는다 — activity 와 근육통을 나눈 것과 같은 원칙.

각 발화에 **무엇이 들어있는지 나열만** 했고 파싱 결과(시각 확정·payload 전체)를 흉내내지
않는다. 판단이 갈리는 부분은 **애매한 점**에만 적고 확정하지 않았다 — 확정은 사람이 한다(2단계).

> ⚠️ 두 카테고리의 payload·part enum·중복 분리·경계는 아직 미확정. 각 case-XXX.json 의
> `expected` 는 지금 비어 있고(빈 배열), 2단계에서 채운다. 카테고리는 현재 10개(food/mood/
> sleep/energy/menstrual/bowel/medication/activity/appetite/digestion)에서 **12개**로 늘어난다.

## 추가할 카테고리 (미확정 초안)

### body_condition — 신체 부위의 상태 (관찰)

| 필드               | 타입                | 설명                                  | 예                            |
| ------------------ | ------------------- | ------------------------------------- | ----------------------------- |
| `part`             | enum (필수)         | 아래 part 목록 중 하나                | scalp / skin / vaginal …      |
| `kind`             | enum                | issue / improvement / neutral (방향)  | —                             |
| `description_text` | 원문 표현 (필수)    | 상태를 **말한 그대로**                | "가렵다", "뒤집어졌다", "매끈해졌다" |
| `self_rating`      | 정수 또는 null      | 사용자가 **직접 매긴** 점수           | "5점 중 2점" → 2              |
| `rating_scale`     | 정수 또는 null      | 그 점수의 만점                        | "5점 중 2점" → 5             |
| `note`             | 문자열 또는 null    | 그 밖의 원문                          | —                             |

- **part enum:** `scalp`(두피) / `hair`(모발) / `skin`(피부) / `vaginal`(질) /
  `nail`(손발톱) / `oral`(구강) / `eye`(눈) / `libido`(성욕) / `other`

### body_care — 관리 행위 (내가 한 것)

| 필드           | 타입                | 설명                          | 예                              |
| -------------- | ------------------- | ----------------------------- | ------------------------------- |
| `part`         | enum (필수)         | body_condition part + 4개 추가 | armpit / foot …                 |
| `action_text`  | 원문 표현 (필수)    | 관리 행위를 **말한 그대로**   | "제모함", "각질 제거", "미백크림 발랐어" |
| `product_text` | 원문 표현 또는 null | 사용한 제품 원문              | "미백크림", "풋크림"            |
| `note`         | 문자열 또는 null    | 그 밖의 원문                  | —                               |

- **part enum:** body_condition 의 9개 + `foot`(발) / `elbow`(팔꿈치) /
  `armpit`(겨드랑이) / `groin`(사타구니).
  ⚠️ body_care 가 body_condition 보다 부위가 4개 많다 — **같은 부위의 상태를 남길 땐
  body_condition enum 에 없어서** `skin`/`other` 로 눌러 담아야 한다(050 참고). 2단계 확정 대상.

## 반드시 지킬 원칙 (사용자 지시)

1. **상태(body_condition)와 행위(body_care)를 섞지 않는다.** "제모하고 나서 따가워" →
   body_care(제모) + body_condition(따가움) **2건.** (activity/근육통 분리와 같은 원칙)
2. **강도를 앱이 숫자로 매기지 않는다.** `description_text` 에 원문을 보존한다.
   (appetite/digestion 의 `intensity_text`, activity 의 `intensity_text` 와 같은 처리)
3. **`self_rating` 은 사용자가 명시적으로 말한 숫자만 채운다.** "5점 중 2점" →
   self_rating=2, rating_scale=5. 말하지 않았으면 null. **상태 서술을 보고 점수를 지어내지 않는다.**
4. **판단하는 라벨을 만들지 않는다.** `kind` 방향(issue/improvement)조차 화면 노출은 주의한다.
   description_text 원문만 보여주는 게 안전하다. (CLAUDE.md 원칙 6)
5. **기존 카테고리가 담당하는 영역이 우선.** 소화 감각 → digestion / 배변 → bowel /
   생리 → menstrual. body_condition 은 이들이 담지 않는 부위만 담는다.

> 커버리지: 두피 가려움+self_rating(041) · 모발(042) · 피부 나빠짐(043) · 피부 좋아짐(044) ·
> 질 상태(045) · 성욕(046) · 각질 관리+제품(047) · 미백 케어+제품(048) · 기존 카테고리 경계(049) ·
> 관리 행위+결과 상태 분리(050).

---

## case-041 — 두피 가려움 + 사용자가 직접 매긴 점수

> "두피가 계속 가렵고 각질도 좀 생겼어. 5점 만점에 2점 정도로 상태가 안 좋아."
> recorded_at: 2026-08-22 22:00 KST

| 종류 | 카테고리       | 내용                                                    | 시각 | 애매한 점                                                       |
| ---- | -------------- | ------------------------------------------------------- | ---- | -------------------------------------------------------------- |
| fact | body_condition | part=scalp, "가렵다"+"각질", self_rating=2, rating_scale=5 | 지금 | 가려움과 각질을 1건(note)으로 볼지 2건으로 나눌지               |

> 🔶 핵심: "5점 만점에 2점"만 숫자로 채운다(self_rating=2/rating_scale=5). "안 좋아"를 보고
> 점수를 지어내면 안 된다. kind=issue 는 자명하나 방향 판정 기준은 2단계.

---

## case-042 — 모발 상태 (탈모/머릿결)

> "요즘 머리가 부쩍 많이 빠지고 머릿결도 푸석푸석해졌어."
> recorded_at: 2026-08-22 09:00 KST

| 종류 | 카테고리       | 내용                                    | 시각 | 애매한 점                                                |
| ---- | -------------- | --------------------------------------- | ---- | -------------------------------------------------------- |
| fact | body_condition | part=hair, "많이 빠짐"+"푸석푸석"        | 요즘 | 빠짐과 푸석을 1건 vs 2건. "요즘"(반복 진술) 시각 처리     |

> 애매: 탈모(빠짐)와 머릿결(푸석)이 같은 part(hair)의 다른 증상. 분리 규칙 미정.

---

## case-043 — 피부 상태 나빠짐

> "어제부터 볼이랑 이마에 뭐가 올라오고 얼굴이 완전 뒤집어졌어."
> recorded_at: 2026-08-23 08:00 KST

| 종류 | 카테고리       | 내용                                    | 시각      | 애매한 점                                     |
| ---- | -------------- | --------------------------------------- | --------- | --------------------------------------------- |
| fact | body_condition | part=skin, kind=issue, "뒤집어졌다"      | 어제부터  | "어제부터"(지속) 시각을 어제로 볼지 지금으로   |

> 핵심: description_text 에 "뒤집어졌다" 원문 보존. "트러블"을 note 로.

---

## case-044 — 피부 상태 좋아짐

> "요즘 피부가 확실히 매끈해지고 트러블도 많이 가라앉았어."
> recorded_at: 2026-08-23 10:00 KST

| 종류 | 카테고리       | 내용                                       | 시각 | 애매한 점                                        |
| ---- | -------------- | ------------------------------------------ | ---- | ------------------------------------------------ |
| fact | body_condition | part=skin, kind=improvement, "매끈해졌다"   | 요즘 | improvement 도 남기는지(043 나빠짐과 대칭) 확인   |

> 핵심: 나쁨만이 아니라 **좋아짐도 관찰로 남는다.** kind=improvement 존재 이유가 이 케이스.

---

## case-045 — 질 관련 상태 (menstrual 아님)

> "요 며칠 아래쪽이 좀 가렵고 따가운 느낌이 있어."
> recorded_at: 2026-08-22 23:00 KST

| 종류 | 카테고리       | 내용                              | 시각   | 애매한 점                                                      |
| ---- | -------------- | --------------------------------- | ------ | ------------------------------------------------------------- |
| fact | body_condition | part=vaginal, "가렵고 따가움"      | 요 며칠 | 완곡표현 "아래쪽" → part=vaginal 매핑 확신도. menstrual 아님   |

> 🔶 경계: 주기 사실이 아니라 부위 상태 → body_condition(vaginal), **menstrual 아님.**
> "아래쪽"을 vaginal 로 확정할지, 애매하면 groin/other 로 둘지 미정.

---

## case-046 — 성욕 언급

> "요즘 들어 통 성욕이 없네."
> recorded_at: 2026-08-22 21:00 KST

| 종류 | 카테고리       | 내용                       | 시각 | 애매한 점                                                         |
| ---- | -------------- | -------------------------- | ---- | ---------------------------------------------------------------- |
| fact | body_condition | part=libido, "성욕이 없다"  | 요즘 | kind 방향 — issue 로 볼지 neutral 로 둘지. 앱이 좋고나쁨 매기면 위험 |

> 🔶 미정: "성욕 없음"을 issue(부정)로 볼지 neutral(중립 관찰)로 둘지. 방향 판단을 앱이
> 하면 판단 라벨이 된다(원칙 6). description_text 원문만으로 충분한지 검토.

---

## case-047 — 각질 관리 + 제품

> "발뒤꿈치 각질 벗겨내고 풋크림 발랐어."
> recorded_at: 2026-08-22 20:00 KST

| 종류 | 카테고리  | 내용                                                | 시각 | 애매한 점                                          |
| ---- | --------- | --------------------------------------------------- | ---- | -------------------------------------------------- |
| fact | body_care | part=foot, action="각질 벗겨냄", product="풋크림"    | 지금 | 각질 제거와 크림 도포를 1건 vs 2건으로 나눌지        |

> 핵심: action_text 와 product_text 분리. 한 발화에 관리 행위 2가지(각질 제거+풋크림) —
> 분리 규칙 미정(food R13/medication R16 의 "따로 성립하면 분리" 적용할지).

---

## case-048 — 미백 케어 + 제품

> "자기 전에 얼굴에 미백크림 꼼꼼히 발랐어."
> recorded_at: 2026-08-22 23:30 KST

| 종류 | 카테고리  | 내용                                             | 시각 | 애매한 점                              |
| ---- | --------- | ------------------------------------------------ | ---- | -------------------------------------- |
| fact | body_care | part=skin, action="미백크림 발랐어", product="미백크림" | 지금 | "꼼꼼히"를 note 로 넣을지               |

> 핵심: product_text="미백크림". action_text 와 중복돼 보여도 원문 그대로 각각 보존.

---

## case-049 — 기존 카테고리와 겹칠 뻔한 것 (경계)

> "아침부터 배가 살살 아프고 눈도 좀 뻑뻑해."
> recorded_at: 2026-08-23 09:00 KST

| 종류 | 카테고리       | 내용                          | 시각 | 애매한 점                                                    |
| ---- | -------------- | ----------------------------- | ---- | ------------------------------------------------------------ |
| fact | digestion      | 배 아픔(pain)                 | 아침 | **body_condition 아님** — 소화 감각은 digestion 우선          |
| fact | body_condition | part=eye, "뻑뻑함"             | 아침 | 눈은 기존 카테고리 없음 → body_condition(eye)                 |

> 🔶 핵심 경계: "배가 아프다"는 body_condition 으로 새면 안 되고 **digestion** 으로 간다
> (원칙 5). 같은 발화의 "눈 뻑뻑함"은 담당 카테고리가 없어 body_condition(eye)로. 과생성
> (배까지 body_condition 으로) 방지가 이 케이스의 목적.

---

## case-050 — 관리 행위와 그 결과 상태가 한 발화에 (분리 확인)

> "겨드랑이 제모하고 나서 좀 따갑고 붉어졌어."
> recorded_at: 2026-08-22 19:00 KST

| 종류 | 카테고리       | 내용                              | 시각 | 애매한 점                                                        |
| ---- | -------------- | --------------------------------- | ---- | --------------------------------------------------------------- |
| fact | body_care      | part=armpit, action="제모함"       | 지금 | —                                                              |
| fact | body_condition | "따갑고 붉어짐", part=?             | 지금 | **겨드랑이 상태의 part** — condition enum 엔 armpit 없음(skin? other?) |
| —    | —              | "제모하고 나서 …"                  | —    | **"~하고 나서"는 순서(R1 비인과 목록) → hypothesis 없음**         |

> 🔶 핵심: 행위(body_care 제모)와 결과 상태(body_condition 따가움)를 **2건으로 분리.** 한
> 이벤트에 섞지 않는다. "~하고 나서"가 인과로 오인돼 가설이 생기면 오분류(R1 닫힌 목록).
> body_care 는 armpit 을 담지만 body_condition 은 못 담는 **enum 비대칭**이 여기서 드러난다.

---

## 2단계에서 확정할 열린 질문 (여기서 정하지 않음)

1. **part enum 확정 + 비대칭 처리** — body_condition(9개) vs body_care(13개). armpit/foot/
   elbow/groin 의 **상태**를 body_condition 으로 남길 때 skin/other 중 무엇으로 눌러 담을지(050).
   그냥 body_condition 에도 4개를 더해 대칭으로 만들지 검토.
2. **kind 방향 판정** — issue/improvement/neutral 을 언제 붙이나. "성욕 없음"(046)이 issue 인지
   neutral 인지. 방향 자체가 판단 라벨이 될 위험(원칙 6) → 화면 표시 규칙과 함께 정한다.
3. **중복 분리 규칙** — 한 발화의 두 신호를 몇 건으로: 가려움+각질(041) / 빠짐+푸석(042) /
   각질제거+크림(047). food R13 / medication R16 의 "따로 성립하면 분리" 기준 적용할지.
4. **경계 규칙(원칙 5) 명문화** — 배 아픔→digestion(049), 배변→bowel, 생리→menstrual, 질
   상태→body_condition(045). "어디부터 body_condition 인가"를 프롬프트에 경계 예시로.
5. **self_rating 규칙** — "5점 중 2점"→2/5(041). 만점을 안 말하고 "2점"만 하면 rating_scale=null?
   "10점 만점에 8점" 등 다른 척도 허용 범위. 서술→점수 추측 금지 재확인.
6. **description_text vs note 경계** — 상태 핵심 서술은 description_text(필수), 부가는 note.
   body_care 의 action_text vs product_text 도 같은 기준.
7. **confidence(R6) 적용** — body_condition/body_care 에 amount 개념 없음 → precision 페널티만
   (activity/appetite/digestion 처럼). R6 에 두 카테고리 명시.
8. **스키마/마이그레이션** — payload 는 jsonb 라 저장은 마이그레이션 불필요하나 **events.category
   CHECK 제약은 확장 필요**(0009 선례처럼 0010 로 body_condition/body_care 추가). schema.ts
   Category + BodyConditionPayload/BodyCarePayload + index.ts zod + v10 프롬프트 + RULES(R22
   body_condition / R23 body_care) 갱신. 순서: RULES → 프롬프트 → 골든셋 expected (CLAUDE.md 원칙 5).
9. **format.ts 표시** — CATEGORY_LABEL/CATEGORY_ICON 에 두 카테고리 추가, summarizeEvent 분기.
   part 를 한글 라벨로(두피/모발/…). kind·self_rating 화면 노출 여부는 2번과 함께.

> 확정 후: RULES(R22/R23 + 경계·분리 규칙) → v10 프롬프트 → case-041~050 expected 채움 →
> 기존 영향 케이스 재점검(신체 신호가 unparsed 로 새던 것) → 배치 재파싱 → test:golden.
