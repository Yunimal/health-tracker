# 골든 테스트셋

실제 발화 30~50건과 기대 출력 쌍을 `*.json` 으로 둔다. (기획서 §6.3)

**프롬프트를 수정할 때마다 회귀 테스트를 돌린다:** `pnpm test:golden`

## 채점 기준

- 이벤트 개수 일치율
- 카테고리 정확도
- `occurred_at` 오차 (±1시간 이내면 통과)
- **가설/사실 오분류 건수 ← 가장 중요한 지표**

## 케이스 형식

`case-XXX.json` 하나가 발화 1건에 대응한다. `expected` 는 기획서 §6.1 출력 계약을 따른다.

```jsonc
{
  "input": {
    "transcript": "...",
    "recorded_at": "2026-08-10T09:00:00+09:00",
    "dictionary": {},
  },
  "expected": {
    "events": [],
    "hypotheses": [],
    "unparsed": [],
  },
}
```

현재 `case-001` ~ `case-010` 10건이 §6.3 커버리지(4개 카테고리 혼재 / 사실+추측 혼재 /
과거 시간 표현 / 모호한 양 / 결식 / 잡담 / 같은 항목 중복 / 수면 상세)를 나눠 맡는다.
각 파일은 `input`(transcript + recorded_at)과 커버 항목 메모(`_covers`)만 채워져 있고
`expected` 는 비어 있다. 발화별 "뽑혀야 할 것" 초안은 [`DRAFT.md`](./DRAFT.md) 에 있으며,
확정 후 각 파일의 `expected` 를 채운다. (STEP 3)

`case-011` ~ `case-018` 은 카테고리 확장(**menstrual / bowel / medication**)을 위한
케이스다(생리 시작·종료·PMS·생리통 / 배변 / 약 복용·잊음·용량변경 / 새+기존 혼재).
초안은 [`DRAFT2.md`](./DRAFT2.md) 에 있다. 새 카테고리의 규칙·payload 스키마는 아직 확정
전이라 `expected` 는 비어 있고, RULES 확정 후 채운다.
