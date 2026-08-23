import Link from "next/link";
import type { DashboardEvent, DashboardPeriod } from "@/lib/db/queries";
import { OUTCOMES, getOutcome } from "@/lib/analysis/outcomes";
import { compareOutcome, type OutcomeComparison } from "@/lib/analysis/compare";
import SaveHypothesisButton from "./SaveHypothesisButton";

/**
 * "무엇이 영향을 줄까" 탭 — outcomes 레지스트리를 읽어 결과를 고르고, 좋았던 날/나빴던 날의
 * 원인 후보를 나란히 보여준다. **상관·확률·결론을 계산하지 않는다.** 단순 빈도(N일 중 M일)만.
 * (기획서 §3, docs/analysis-design.md, CLAUDE.md 원칙 6)
 */

/** "2026-08-23" → "8/23" (칩 표시용). */
function shortDay(ymd: string): string {
  const [, m, d] = ymd.split("-");
  return `${Number(m)}/${Number(d)}`;
}

function DayChips({ days }: { days: string[] }) {
  if (days.length === 0) return <span className="text-[11px] text-gray-300">없음</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {days.map((d) => (
        <span key={d} className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">
          {shortDay(d)}
        </span>
      ))}
    </span>
  );
}

export default function InsightsTab({
  events,
  periodDays,
  today,
  selectedId,
  period,
}: {
  events: DashboardEvent[];
  periodDays: number;
  today: string;
  selectedId: string;
  period: DashboardPeriod;
}) {
  // 각 결과의 비교 결과를 한 번씩 계산(버튼의 "N일" 표시 + 선택된 결과 상세에 재사용).
  const computed = OUTCOMES.map((o) => ({
    outcome: o,
    cmp: compareOutcome(o.id, events, periodDays, { today }),
  }));

  const selected = getOutcome(selectedId) ?? OUTCOMES[0]!;
  const current = computed.find((c) => c.outcome.id === selected.id)!;
  const cmp: OutcomeComparison = current.cmp;
  const classifiedOf = (c: OutcomeComparison) => c.goodDays.length + c.badDays.length;

  // 원인 후보: difference 내림차순, 상위 10개. (difference 는 정렬용일 뿐 — 점수로 보여주지 않는다)
  const topFactors = [...cmp.factors].sort((a, b) => b.difference - a.difference).slice(0, 10);

  return (
    <div className="flex flex-col gap-4">
      {/* 1. 결과 선택 — outcomes 레지스트리에서 자동 생성 */}
      <section className="flex flex-col gap-1">
        <h2 className="text-sm font-medium">무엇에 대해 볼까요?</h2>
        <div className="flex flex-wrap gap-2">
          {computed.map(({ outcome, cmp: c }) => {
            const active = outcome.id === selected.id;
            const days = classifiedOf(c);
            return (
              <Link
                key={outcome.id}
                href={`/dashboard?tab=insights&days=${period}&outcome=${outcome.id}`}
                className={
                  active
                    ? "rounded-full bg-gray-900 px-3 py-1 text-xs text-white"
                    : "rounded-full border border-gray-300 px-3 py-1 text-xs text-gray-700 hover:bg-gray-50"
                }
              >
                {outcome.label}
                <span className={active ? "ml-1 text-gray-300" : "ml-1 text-gray-400"}>
                  · {days}일
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      {/* 4. lookback 명시 — 결과마다 다르다 */}
      <p className="text-[11px] text-gray-500">
        {selected.label} 기준, 이전 {selected.lookbackHours}시간 안의 기록을 원인 후보로 봅니다.
      </p>

      {/* 3. presence 결과 한계 안내 */}
      {selected.kind === "presence" && (
        <p className="rounded border border-gray-200 bg-gray-50 px-3 py-2 text-[11px] text-gray-500">
          &lsquo;없었음&rsquo; 은 &lsquo;말하지 않음&rsquo; 을 포함해요. 기록이 3건 이상인 날만 셌습니다.
        </p>
      )}

      {!cmp.enoughData ? (
        // 2-a. 데이터 부족 — 비교표 대신 지금까지 기록된 날을 보여준다(뭘 더 기록해야 하는지)
        <section className="flex flex-col gap-3">
          <p className="rounded-lg border border-gray-300 px-3 py-3 text-sm text-gray-700">
            좋았던 날 {cmp.goodDays.length}일 / 나빴던 날 {cmp.badDays.length}일 — 비교하려면 각각{" "}
            {cmp.minSamplesNeeded}일이 필요해요.
          </p>
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-gray-500">좋았던 날 ({cmp.goodDays.length}일)</span>
              <DayChips days={cmp.goodDays} />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-gray-500">나빴던 날 ({cmp.badDays.length}일)</span>
              <DayChips days={cmp.badDays} />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-gray-400">
                아직 판단 못 한 날 ({cmp.unknownDays.length}일) — 결과 기록이 없거나 부족한 날
              </span>
              <DayChips days={cmp.unknownDays} />
            </div>
          </div>
        </section>
      ) : (
        // 2-b. 데이터 충분 — 원인 후보 비교표
        <section className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-medium">원인 후보</h3>
            <span className="text-[11px] text-gray-400">각 칸 = 그 항목이 나타난 날 수</span>
          </div>

          {/* 헤더: 표본 수(N일)를 항상 노출 */}
          <div className="flex items-center gap-2 border-b border-gray-200 pb-1 text-[11px] text-gray-500">
            <span className="flex-1">항목</span>
            <span className="w-14 text-right">좋음 {cmp.goodDays.length}일</span>
            <span className="w-14 text-right">나쁨 {cmp.badDays.length}일</span>
            <span className="w-16" />
          </div>

          <ul className="flex flex-col">
            {topFactors.map((f) => (
              <li key={f.id} className="flex items-center gap-2 border-b border-gray-100 py-1.5">
                <span className="min-w-0 flex-1 truncate text-sm">{f.label}</span>
                <span className="w-14 text-right text-sm tabular-nums">{f.goodCount}일</span>
                <span className="w-14 text-right text-sm tabular-nums">{f.badCount}일</span>
                <span className="flex w-16 justify-end">
                  <SaveHypothesisButton cause={f.label} effectLabel={selected.label} />
                </span>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-gray-400">
            숫자가 큰 차이여도 표본이 적으면 우연일 수 있어요. 나란히 보고 직접 판단하세요.
          </p>
        </section>
      )}
    </div>
  );
}
