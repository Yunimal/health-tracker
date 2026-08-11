# 골든셋 확정 규칙

DRAFT.md 검토 결과 확정된 파싱 규칙. STEP 3 의 파싱 프롬프트(v1.md)는
이 문서를 근거로 작성한다. 골든셋과 프롬프트는 항상 같은 규칙을 따른다.

## R1. 인과 판별 — 연결어 뒤의 "결과"가 무엇이냐로 갈린다

인과 연결어(~해서, ~때문에, ~라서, ~인지, ~탓에)가 나왔을 때:

- 연결어 뒤의 결과가 **신체·감정 상태**면 → hypothesis 로 뽑는다.
  동시에 연결어 양쪽의 각 항목을 별도 fact 로도 남긴다.
- 연결어 뒤의 결과가 **사용자의 행동**(먹었다/마셨다/했다)이면
  → hypothesis 로 뽑지 않는다. 각 항목만 fact 로 남긴다.

예:
- "잠 설쳐서 처졌어" → 결과가 상태 → hypothesis O
  (fact sleep: 수면 질 저하 + fact energy: 처짐 + hypothesis: 수면부족→처짐)
- "졸려서 커피 마셨어" → 결과가 행동 → hypothesis X
  (fact energy: 졸림 + fact food: 커피)

~해서(확신)와 ~인지(추측)는 어조가 달라도 검증되지 않은 인과라는 점에서
동일하므로 똑같이 처리한다.

원인/결과가 4개 카테고리 밖이어도 hypothesis 는 생성한다. hypotheses 는
자유 텍스트(cause_hint/effect_hint)라 카테고리 제약이 없다.
(예: "등산 갔다 와서 다리가 뻐근했어" → 둘 다 카테고리 밖이지만 hypothesis O)

## R2. unparsed 는 쓰레기통이 아니다

- 건강 신호이지만 현재 4개 카테고리(food/mood/sleep/energy)로 담을 수
  없는 것만 unparsed 에 넣는다.
- 건강과 무관한 잡담(회의, 택배, 일정 등)은 어디에도 남기지 않는다.
- 카테고리 밖 건강 신호는 hypothesis 의 cause_hint/effect_hint 에 쓰였더라도
  unparsed 에 원문을 별도 보존한다. hypothesis 는 검증용 메모이고 unparsed 는
  Phase 2 재파싱용 원본이라 목적이 다르다. (예: "멜라토닌 안 먹음")

unparsed 의 목적은 Phase 2 에서 카테고리를 추가한 뒤 재파싱으로 되살리는
것이다. 잡담이 섞이면 그 재파싱이 노이즈 청소 작업이 된다.

## R3. 배고픔·식욕 → unparsed (mood 아님)

배고픔은 감정도 각성 수준도 아니다. mood 에 넣으면 valence 축이 오염된다.
Phase 2 에서 appetite 카테고리를 추가할 1순위 후보이므로 unparsed 에
원문을 남겨 복구 가능하게 한다.

## R4. energy 와 mood 의 구분

- energy = 몸의 각성 수준: 처짐, 나른함, 졸림, 활력, 기력
- mood    = 감정의 방향: 괜찮음, 짜증, 불안, 우울

한 서술을 두 카테고리로 중복 생성하지 않는다.
단, 서로 다른 서술이 각각 있으면 둘 다 뽑는다.
(예: "처졌어"(energy) + "기분은 괜찮아"(mood) → 이벤트 2건)

## R5. 수량 — 지어내지 않는다

| 발화 유형 | amount_value | amount_unit |
|---|---|---|
| 명시적 수치 ("80그램") | 80 | "g" |
| 셀 수 있는 단위 ("두 개","한 잔","세 조각","한 그릇") | 2, 1, 3, 1 | "개","잔","조각","그릇" |
| 모호한 양 ("세 모금","좀","조금","몇 알") | null | null |

- amount_text 에는 항상 원문 표현을 그대로 넣는다.
- amount_unit 은 enum 으로 제한하지 않고 자유 문자열로 둔다.
- 단위 정규화(한 잔 = 몇 ml)는 하지 않는다. 개인 사전으로 나중에 푼다.
- completion_ratio 는 발화에 비율이 명시된 경우만 채운다.
  ("80% 정도" → 0.8 / "다 비웠다" → 1.0 / 언급 없음 → null)
  "다 비웠다"는 추정이 아니라 명시이므로 1.0 으로 채운다.
- 양 미언급 = 되물을 수 있는 항목 → 페널티. 양 개념 부재 = 되물을 수 없음 → 페널티 없음.
  (전자는 food/drink 로 -0.30, 후자는 skipped_meal 로 페널티 없음. R6 참조)

## R6. 시각 추정과 confidence

### 시각 기준표 (테스트 결정성을 위해 고정)

| 표현 | occurred_at | precision |
|---|---|---|
| 방금, 지금 | recorded_at | exact |
| 아까 | recorded_at - 1시간 | hour |
| 새벽 | 03:00 | part_of_day |
| 아침 | 08:00 | part_of_day |
| 오전 (내내) | 09:00 | part_of_day |
| 점심 | 12:30 | part_of_day |
| 오후 | 15:00 | part_of_day |
| 저녁 | 19:00 | part_of_day |
| 밤 | 23:00 | part_of_day |
| 시간 단서 없음 | recorded_at | hour |

날짜는 발화의 상대 표현("어제","지난 주말")을 recorded_at 기준으로 계산한다.

sleep 카테고리에서 날짜 단서만 있고 시간대 키워드(밤/새벽 등)가 없으면
→ 해당 날짜 23:00, precision part_of_day. (예: "어제 잠을 설쳤어" → 어제 23:00)

### confidence 계산식

1.00 에서 시작해 아래를 차감한다. 하한은 0.30.

- 양이 모호하거나 미언급 (amount_value 가 null) : -0.30
  단, kind 가 food/drink 일 때만 적용한다. kind 가 skipped_meal 이면 적용하지 않는다.
  (결식에는 "양" 개념이 없으므로 되물을 수 없다)
- 시각이 추정임 (precision 이 exact 가 아님) : -0.20
- 범위 표현을 최솟값으로 취함 (R7) : -0.20

결과가 0.70 미만이면 needs_review = true.
손으로 어림잡지 말고 반드시 이 식으로 계산한다.

## R7. 범위 표현

"두어 번", "두세 개" 같은 범위 표현은 **최솟값**을 취한다.
("두어 번" → 2, "두세 개" → 2)
이 경우 confidence 에서 -0.20 을 추가 차감한다.

## R8. 수면 질 수치화

| 발화 | quality |
|---|---|
| 푹 잤다 / 잘 잤다 | 4 |
| 그냥 잤다 / 언급 없음 | 3 |
| 설쳤다 / 푹 못 잤다 / 잠이 안 왔다 | 2 |
| 거의 못 잤다 | 1 |

## R9. mood 수치화

valence: 매우 부정 -2 / 부정 -1 / 중립 0 / 긍정 +1 / 매우 긍정 +2
arousal: 차분 0 / 보통 1 / 다소 각성 2 / 매우 각성 3

"그럭저럭 괜찮아" → valence +1, arousal 1

## R10. energy 수치화

1 탈진 / 2 처짐·나른함·졸림 / 3 보통 / 4 활력 / 5 매우 활력

## R11. 결식(skipped_meal) payload

kind: "skipped_meal", meal_type: 해당 끼니.
name / name_raw / amount_text / amount_value / amount_unit / completion_ratio 는 모두 null.
name 에 끼니 이름("아침","점심")을 넣지 않는다 — meal_type 과 중복되고,
집계 시 음식으로 잡힌다. 끼니 정보는 meal_type 하나로만 표현한다.

## R12. 값 없음은 항상 null

빈 문자열("")을 쓰지 않는다. 값이 없으면 null.

======================= 케이스별 확정 =======================

| case | 항목 | 확정 |
|---|---|---|
| 001 | 배고픔 | unparsed (R3) |
| 001 | "졸려서 커피" | hypothesis 아님 (R1) |
| 001 | 쿠크다스 meal_type | snack |
| 001 | 아침 결식 | skipped_meal, name null (R11). amount 페널티 없음 → conf 0.80 (R6) |
| 001 | 멜라토닌 | cause_hint + unparsed 별도 보존 (R2) |
| 002 | "잠 설쳐서 처졌다" | fact(sleep) + fact(energy) + hypothesis (R1) |
| 002 | 토스트+계란 | 이벤트 2건으로 분리. 나중에 계란 단독 패턴을 볼 수 있어야 함 |
| 005 | 등산 | unparsed |
| 005 | 다리 뻐근함 | unparsed. 근육통은 각성 수준이 아니라 운동의 결과이므로 등산과 함께 유예 |
| 005 | 등산→다리 뻐근 | hypothesis 생성 (R1). 등산·뻐근 원문은 unparsed 유지 |
| 007 | 배고픔 | unparsed (R3) |
| 007 | 점심 결식 | skipped_meal, name null (R11). amount 페널티 없음 → conf 0.80 (R6) |
| 008 | 전체 | events / hypotheses / unparsed 모두 빈 배열 (R2) |
| 009 | 아메리카노 2회 | 별도 이벤트 2건. 이름이 같아도 시각이 다르면 다른 사건 |
| 010 | "12시 좀 넘어" | bedtime 00:00, precision hour |
| 010 | "두어 번" | interruptions 2 (R7) |
| 010 | "푹 잔 느낌 아님" | quality 2 (R8) |

======================= RULES.md 내용 끝 =======================

## 미해결

현재 없음. 직전 Q1~Q5 는 아래와 같이 해소되어 규칙에 반영됨.

- Q1 (결식 payload) → **R11** 신설. name/name_raw 포함 전부 null, 끼니는 meal_type 만.
- Q2 (양 미언급 food/drink 페널티) → 유지. **R5** 에 사유 추가, **R6** 에 kind 조건 명시.
- Q3 (카테고리 밖 원인 보존) → **R2** 에 unparsed 별도 보존 명시.
- Q4 (카테고리 밖 hypothesis) → **R1** 에 생성한다고 명시. case-005 hypothesis 추가.
- Q5 (시간대 없는 sleep) → **R6** 에 "날짜만 있으면 23:00 part_of_day" 명문화.
