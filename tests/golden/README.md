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

`case-001.json` 은 기획서 §2 예시 발화를 옮긴 시드 케이스다. (TODO: STEP 3 에서 기대 출력을 채운다.)
