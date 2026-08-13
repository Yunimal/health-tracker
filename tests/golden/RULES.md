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

### 연결어 목록은 닫힌 목록이다

인과 연결어는 다음이 전부다: ~해서, ~때문에, ~라서, ~인지, ~탓에.
이 목록에 없는 표현은 인과로 보지 않는다.

특히 시간 순서를 나타내는 표현은 인과가 아니다:
~고 나서, ~다음에, ~이후에, ~하고, ~한 뒤에
"김치찌개 먹고 나서 더부룩" 은 순서를 말한 것이지 원인을 주장한 것이 아니다.

"~는데" 는 검토했으나 비인과 용법이 압도적이라("밥 먹었는데 배고파") 목록에 넣지 않았다.
실사용에서 인과 용법이 자주 확인되면 재검토한다.

(실제 사용 중 목록에 없는 인과 표현이 발견되면 이 목록에 추가한다.
 목록을 열어두고 파서가 판단하게 하지 않는다 — 없는 가설을 만드는 것이
 놓치는 것보다 해롭다)

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

주말은 이틀(토·일)에 걸쳐 모호하므로 **토요일로 고정**한다(결정성 우선):
- "지난 주말" → recorded_at 직전 토요일, 12:00, precision "date"
- "이번 주말" → recorded_at 기준 가장 가까운 토요일, 12:00, precision "date"

날짜 단서만 있고 시간대 키워드가 없을 때:
- sleep 카테고리 → 해당 날짜 23:00, precision "part_of_day" (기존 유지)
- 그 외 카테고리 → 해당 날짜 12:00, precision "date"

정오로 두는 이유: date precision 은 "그 날짜 어딘가"를 뜻하는데
00:00 은 전날과 경계가 맞닿아 시간대 변환 한 시간 오차로도
날짜가 넘어간다. 정오는 양쪽으로 12시간 여유가 있다.

### confidence 계산식

1.00 에서 시작해 아래를 차감한다. 하한은 0.30.

- 양이 모호하거나 미언급 (amount_value 가 null) : -0.30
  단, kind 가 food/drink 일 때만 적용한다. kind 가 skipped_meal 이면 적용하지 않는다.
  (결식에는 "양" 개념이 없으므로 되물을 수 없다)
- 시각이 추정임 (precision 이 exact 가 아님) : -0.20
- 범위 표현을 최솟값으로 취함 (R7) : -0.20
- 확신 없는 어조 (R17) : -0.20

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

## R13. 음식 항목의 분리

한 끼에 여러 음식이 언급되면 각각 별도 이벤트로 분리한다.
"A에 B", "A랑 B", "A하고 B" 같은 연결도 분리 대상이다.

단, 하나의 요리 이름으로 굳어진 것은 분리하지 않는다.
(잔치국수, 소떡소떡, 짜장면 등은 재료로 쪼개지 않는다)

판별 기준: 그 음식만 따로 먹을 수 있으면 분리,
요리의 구성요소면 유지한다.
예) "토스트에 계란 하나" → 2건 / "잔치국수 한 그릇" → 1건

## R14. menstrual — 관찰된 주기 사실만 기록한다

payload:
  kind: "start" | "end" | "ongoing"   (필수)
  cycle_day: 정수 또는 null            ("이틀째" → 2)
  flow: "spotting" | "light" | "normal" | "heavy" | null
  pain: 1~5 또는 null                  (1 없음 ~ 5 매우 심함)
  note: 문자열 또는 null

- 예측·추정("생리 며칠 전", "곧 할 것 같아")은 이벤트로 만들지 않는다.
  주기 위치는 start 이벤트에서 계산하는 것이 정확하다.
  추정 내용은 hypothesis 의 statement 에 보존된다.
- PMS 로 인한 감정·기력은 menstrual 이 아니라 mood / energy 로 간다.
  menstrual 에 중복 생성하지 않는다. (R4 와 동일 원칙)
- 생리통은 menstrual 의 pain 필드로 기록한다.
- 통증 수치화: 언급만 1~2 / "좀 아파" 2 / "아파" 3 / "심해" 4 / "너무 심해" 5
- kind 가 "start" 이면 cycle_day 를 1 로 채운다. (시작일이 1일차라는 정의)
- kind 가 "ongoing" 이면 발화에 명시된 경우에만 채우고, 아니면 null.
  직전 start 이벤트에서 역산하지 않는다 — 주기 계산은 조회 시점의 일이다.
- pain 은 별도 이벤트로 만들지 않고 같은 menstrual 이벤트의 필드로 넣는다.
  생리통은 주기 상태의 속성이지 독립된 사건이 아니다.

### 종료 진술과 당일 관찰의 분리

"어제 끝난 것 같아, 오늘은 거의 안 묻어" 처럼 종료 시점과 관찰 시점이
다른 날이면 두 이벤트로 나눈다.
- end 이벤트 → 종료로 진술된 날짜
- ongoing 이벤트 → 관찰한 날짜 (flow 는 관찰 내용대로)
같은 날이면 (예: "오늘 끝났어, 거의 안 묻어") 한 이벤트로 합친다.

판별 기준은 서술의 종류가 아니라 날짜다. 다른 날에 일어난 일은
다른 이벤트다.

### flow 문구 매핑

거의 안 묻어남 / 아주 조금 → spotting
적음 / 조금 → light
보통 / 평소만큼 → normal
많음 / 샐 정도 → heavy
언급 없음 → null

(이 매핑은 v3 프롬프트에만 있었다. RULES.md 가 규칙의 원본이므로 여기로 올린다)

## R15. bowel — 배변 활동

payload:
  bristol: 1~7 또는 null
  count: 정수 또는 null
  note: 문자열 또는 null

- "화장실" 언급만으로는 이벤트를 만들지 않는다 (소변일 수 있다).
  배변을 명시했거나 형태·상태 묘사가 있을 때만 만든다.
- 브리스톨 매핑:
  토끼똥·염소똥 1 / 딱딱함 2 / 약간 딱딱 3 / 보통·정상·괜찮음 4 /
  무름 5 / 묽음 6 / 물설사 7
  형태 묘사가 전혀 없으면 null.
- 소화불량·더부룩·복부팽만은 bowel 이 아니다 → unparsed.
  (배변 활동이 아니라 소화 증상이다. 잦으면 나중에 digestion 카테고리를 만든다)

## R16. medication — 약·영양제

payload:
  kind: "taken" | "skipped" | "dose_change"   (필수)
  name: 문자열 (필수)
  dose_text: 원문 표현 또는 null      ("한 알", "반 알")
  dose_value: 숫자 또는 null
  dose_unit: 문자열 또는 null          ("알", "mg")
  dose_from / dose_to: dose_change 일 때만, 아니면 null
  note: 문자열 또는 null

- 여러 약이 언급되면 각각 별도 이벤트 (R13 과 동일 원칙)
- 복용을 잊은 것도 기록한다 → kind: "skipped" (결식과 동일한 취급)
- 용량 변경 선언은 kind: "dose_change" 로 별도 기록한다.
  복용 이벤트로 만들지 않는다 — 실제로 먹지 않은 날까지
  복용한 것으로 집계되기 때문이다.
- dose 미언급은 confidence 를 깎지 않는다.
  상비 복용은 용량이 고정이라 매번 말하지 않는 것이 정상이고,
  되물어도 새 정보가 나오지 않는다. (R6 의 amount 페널티와 다른 이유)

## R17. 불확실한 어조

"~것 같아", "~인 듯", "아마" 처럼 사실 자체에 확신이 없는 표현은
hypothesis 가 아니라 fact 로 기록하되 confidence 에서 -0.20 한다.
R1 은 인과 주장에만 적용된다. 사실에 대한 불확신은 인과가 아니다.

## R18. activity — 운동·신체활동

payload:
  name: 문자열 (필수)                 "산책", "등산", "헬스"
  duration_min: 정수 또는 null         "30분" → 30
  distance_km: 숫자 또는 null          "5km" → 5
  intensity_text: 원문 표현 또는 null  "빡세게", "가볍게"
  note: 문자열 또는 null

- intensity 를 숫자로 매기지 않는다. 사람마다 기준이 달라 비교가 무의미하다.
  말한 표현을 intensity_text 에 그대로 보존한다. (mood/energy 의 수치화와 다른 처리)
- name 은 발화에 쓰인 단어를 그대로 쓴다. "산책"을 "걷기"로 바꾸지 않는다.
  용어 통일은 조회 시점의 일이다.
- duration_min / distance_km 이 없어도 confidence 를 깎지 않는다.
  R16(medication) 의 dose 와 같은 이유 — 되물어도 정확한 답이 나오지 않는
  항목은 되물을 수 있는 항목이 아니다.

### 운동을 하지 않은 것은 기록하지 않는다

"오늘 운동 못 했어" 는 activity 이벤트로 만들지 않는다. 발화 원문은 unparsed 에 남긴다.

이유: 끼니는 하루 세 번이라는 정해진 슬롯이 있어 결식(skipped_meal)이 관찰이 되지만,
운동에는 슬롯이 없다. "안 했다" 를 이벤트로 만들면 말한 날만 기록되고 말하지 않은 날은
누락되어, 집계가 실제와 어긋난다. 운동을 안 한 날은 activity 이벤트가 없는 날로 표현된다.
(medication 의 skipped 와 다르게 취급하는 이유: 약은 정해진 복용 스케줄이라는 슬롯이 있다)

### 운동 후 증상은 activity 가 아니다

근육통, 뻐근함, 알 배김 등은 행동이 아니라 결과인 증상이므로 activity 에 넣지 않고
unparsed 로 보낸다. activity 는 행동을 담는 카테고리다. (R15 의 소화 증상 분리와 같은 원칙)

## R19. food — 섭취 동기

food payload 에 두 필드를 추가한다:

  reason_text: 원문 표현 또는 null      "입이 심심해서", "배고파서"
  reason: 아래 중 하나 또는 null
    hunger   배가 고파서
    boredom  입이 심심해서 / 심심해서
    craving  당겨서 / 먹고 싶어서 / 멈추기 어려웠음
    social   같이 먹느라 / 누가 줘서
    routine  때가 돼서 / 습관적으로
    emotion  스트레스 / 기분 때문에

### 추측 금지

발화에 이유가 진술되지 않았으면 둘 다 null 이다. 상황으로 미루어 짐작하지 마라.
"야근하다가 밤늦게 삼각김밥" 은 이유가 없다 — 배고팠을 것 같아도 null. 왜 먹었는지는
본인만 아는 것이고, 파서가 짐작해 채우면 그 데이터는 분석에 쓸 수 없다. 이유가 없다고
confidence 를 깎지 않는다. 말하지 않는 것이 정상이다. (R16 dose / R18 duration 과 같은 결)

### R3 과의 관계 (충돌 아님)

- 음식 없이 단독으로 진술된 배고픔 → unparsed (R3 유지). 예: "아침 못 먹고 나와서 배가 고파"
- 섭취의 이유로 진술된 배고픔 → 해당 food 이벤트의 reason. 예: "배고파서 밥 먹었어"

이유로 쓰인 배고픔을 unparsed 에 중복해서 넣지 않는다. 기존 case-001 / case-007 은
전자(단독 진술)에 해당하므로 변경 없다.

### 이유의 귀속 범위

한 섭취 상황에 이유가 하나면 그 상황의 모든 음식에 같은 이유를 붙인다.
("배고파서 떡볶이랑 순대랑 튀김" → 세 이벤트 모두 hunger)
음식마다 다른 이유가 명시되면 각각 그 이유를 쓴다.
("배고파서 밥 먹고, 입이 심심해서 초코파이" → 각각 hunger / boredom)

### 다른 카테고리와 중복하지 않는다

이유로 쓰인 감정은 mood 이벤트로 다시 만들지 않는다. (R4 와 같은 원칙) 단, 별개 서술로
감정이 진술되면 그것은 mood 로 뽑는다.
예: "스트레스 받아서 라면 먹었어" → reason=emotion, mood 이벤트 없음.
    "먹고 나니 후련" → 별개 서술이므로 mood 이벤트 생성.

### reason_text

이유를 가장 직접적으로 진술한 구절 하나만 원문 그대로 넣는다. 단서가 여러 군데면 가장
명확한 것을 고른다. 분류(reason)는 조회를 위한 보조이고 원문이 우선이다.

### 표시 규칙

reason enum 값을 화면에 노출하지 않는다. reason_text 만 보여준다. craving 을 "중독적",
"폭식" 같은 판단하는 말로 표시하지 않는다. 매일 보는 자기 기록에 판단 라벨이 붙으면
관찰 도구가 아니라 자책 도구가 된다. (표시 원칙은 CLAUDE.md 에도 박아 둔다)

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
| 005 | 등산 | **activity 이벤트** (R18). "지난 주말"→토요일 8/8 12:00 date. unparsed 에서 이동 |
| 005 | 다리 뻐근함 | unparsed 유지. 근육통은 운동의 결과인 증상 (R18) |
| 005 | 등산→다리 뻐근 | hypothesis 존치 (R1, "~와서"=인과). 등산은 activity 로 잡히고 뻐근함 원문만 unparsed |
| 007 | 배고픔 | unparsed (R3) |
| 007 | 점심 결식 | skipped_meal, name null (R11). amount 페널티 없음 → conf 0.80 (R6) |
| 008 | 전체 | events / hypotheses / unparsed 모두 빈 배열 (R2) |
| 009 | 아메리카노 2회 | 별도 이벤트 2건. 이름이 같아도 시각이 다르면 다른 사건 |
| 010 | "12시 좀 넘어" | bedtime 00:00, precision hour |
| 010 | "두어 번" | interruptions 2 (R7) |
| 010 | "푹 잔 느낌 아님" | quality 2 (R8) |
| 011 | 생리 시작 | menstrual(start, flow=light). "양은 적어" → light |
| 012 | 생리 종료 | 2건: menstrual(end) @ 어제 12:00 date (R17 → conf 0.60) + menstrual(ongoing, flow=spotting, "거의 안 묻어남") @ recorded_at hour (conf 0.80). 종료(어제)와 당일 관찰(오늘)은 날짜가 달라 분리 |
| 013 | PMS+감정 | mood(예민·짜증) + energy(몸 무거움) + hypothesis(생리 전 → 예민). menstrual 이벤트 없음 (R14) |
| 014 | 생리통+진통제 | menstrual(ongoing, pain=4) + medication(taken, 진통제, 한 알). "심해서 진통제" 결과가 행동 → hypothesis 아님 (R1) |
| 015 | 배변 2건 | 오늘(bristol 4) + 어제(bristol 2) |
| 016 | 약 3건 | 유산균(taken) + 비타민D(taken) + 오메가3(skipped) |
| 017 | 약 용량 변경 | medication(dose_change, 갑상선약, dose_from="반 알", dose_to="한 알") |
| 018 | 혼재 | food(김치찌개) + menstrual(ongoing, cycle_day=2) + medication(taken, 유산균) + energy(피곤). "더부룩" → unparsed (R15) |
| 019 | 시간 명시 운동 | activity(걷기), duration_min=30. "아침"→08:00 part_of_day (conf 0.80) |
| 020 | 시간 없는 운동 | activity(산책), duration_min=null. "방금"→recorded_at exact (conf 1.00) |
| 021 | 강도 표현 | activity(운동), intensity_text="빡세게" 원문 보존. 강도 숫자화 금지 (R18). "저녁"→19:00 part_of_day |
| 022 | 운동+식사 연접 | food(김밥) + activity(산책) @ 점심 12:30. "먹고 바로"=시간 순서 → hypothesis 아님 (R1 닫힌 목록) |
| 023 | 운동 후 증상 | activity(등산) @ 어제 12:00 date + unparsed(허벅지 뻐근함). **hypothesis 없음** — "~는데"는 R1 목록 밖(비인과) |
| 024 | 운동 안 함 | activity 이벤트 없음 (R18). 발화는 unparsed 로만 |
| 025 | 음식별 다른 이유 | food(밥, reason=hunger "배고파서") @아침 08:00 + food(초코파이, reason=boredom "입이 심심해서") @오후 15:00. 이유는 음식별로 (R19) |
| 026 | craving | food(초콜릿, reason=craving "자꾸 당겨서", "한 봉지" 1, completion 1.0) @자기 전=23:30 hour. "멈추기 어려움"은 unparsed 아님 — craving 에 흡수 |
| 027 | 이유 없는 식사 | food(김치찌개)+food(공깃밥) 각 reason=null @점심 12:30. reason 부재는 무페널티 → conf 0.50 (amount·시각만) |
| 028 | 상황만, 이유 없음 | food(삼각김밥, reason=null, "하나" 1) @밤늦게 23:00. 야근/밤늦게로 hunger 를 **짐작 금지** (R19) |
| 029 | 음식 여럿+이유 하나 | food×3(떡볶이/순대/튀김) 모두 reason=hunger "배고파서" @recorded 17:00 hour. 이유 하나가 전부에 귀속 (R19) |
| 030 | 이유+기분 혼재 | food(매운 라면, reason=emotion "스트레스 받아서")+mood(후련, +1) @recorded 20:00. 스트레스는 mood 이벤트 아님, "후련"만 mood (R19/R4). "~서 먹었어" 결과=행동 → hypothesis 없음 (R1) |

> case-023 은 hypothesis 를 만들지 않는다. "어제 등산 다녀왔는데 오늘 뻐근하네" 의 "~는데"는
> R1 의 닫힌 인과 연결어 목록(~해서/~때문에/~라서/~인지/~탓에) 밖이고 비인과 용법이
> 압도적이다(R1 하단 참고). "~는데+증상" 을 인과로 좁혀 잡게 하면 파서가 "결과가 증상인가"를
> 스스로 판단해야 하고, 그 판단을 열었다가 v5 에서 case-018 이 깨졌다 — 목록을 닫아 둔 이유다.
> (case-005 의 "~와서"는 R1 목록 안이라 hypothesis 존치한다.)

======================= RULES.md 내용 끝 =======================

## 미해결

직전 Q1~Q5 는 규칙에 반영되어 해소됨:

- Q1 (결식 payload) → **R11** 신설. name/name_raw 포함 전부 null, 끼니는 meal_type 만.
- Q2 (양 미언급 food/drink 페널티) → 유지. **R5** 에 사유 추가, **R6** 에 kind 조건 명시.
- Q3 (카테고리 밖 원인 보존) → **R2** 에 unparsed 별도 보존 명시.
- Q4 (카테고리 밖 hypothesis) → **R1** 에 생성한다고 명시. case-005 hypothesis 추가.
- Q5 (시간대 없는 sleep) → **R6** 에 "날짜만 있으면 23:00 part_of_day" 명문화.

Q6~Q8 도 규칙에 반영되어 해소됨:

- Q6 (날짜만 있는 비-sleep occurred_at) → **R6** 에 "그 외 카테고리 → 해당 날짜 12:00,
  precision date" 명문화. case-012 / 015#2 / 017 을 12:00 date 로 수정.
- Q7 (case-018 아랫배 통증) → **R14** 에 "pain 은 별도 이벤트 아니라 같은 menstrual
  이벤트 필드" 명시. 018 은 pain=3, cycle_day=2 유지.
- Q8 (menstrual start cycle_day) → **R14** 에 "start 이면 cycle_day 1" 명문화.
  case-011 을 cycle_day 1 로 수정.

DRAFT3 확정(운동 카테고리):

- **R18** 신설(activity). name 원문 보존 · intensity 숫자화 금지 · duration/distance null
  페널티 없음 · "운동 안 함" 미기록(unparsed) · 운동 후 증상은 unparsed.
  case-019~024 확정, case-005 는 등산을 unparsed→activity 로 이동(hypothesis·뻐근함은 유지).
- case-023 "~는데": R1 에 **추가하지 않기로 확정**. hypothesis 제거(activity+unparsed 만).
  R1 하단에 검토 결과 명시.
- R6 에 주말 시각 규칙 추가(지난/이번 주말 → 토요일 12:00 date).

DRAFT4 확정(food 섭취 동기):

- **R19** 신설(food reason). reason_text(원문 1구절)+reason(6종 enum). 추측 금지(이유 없으면
  둘 다 null, 무페널티) · R3 과 충돌 아님(단독 배고픔 unparsed / 이유로 쓰인 배고픔 reason,
  기존 001·007 변경 없음) · 이유 하나면 상황의 모든 음식에 귀속 · 이유로 쓰인 감정은 mood
  중복 생성 안 함 · reason enum 화면 비노출(reason_text 만). case-025~030 확정. 마이그레이션
  불필요(events.payload jsonb, 0007 이 앱 zod 검증 명시). schema.ts·index.ts zod·v8 프롬프트만 갱신.
