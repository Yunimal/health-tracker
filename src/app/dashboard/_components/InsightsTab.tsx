import Link from "next/link";
import { formatWhen, summarizeEvent } from "@/lib/format";
import type { DashboardPeriod, InsightEvent } from "@/lib/db/queries";
import { OUTCOMES, getOutcome, kstDateOf, readScaleValue } from "@/lib/analysis/outcomes";
import { compareOutcome, withinLookback } from "@/lib/analysis/compare";
import { extractInputFactors } from "@/lib/analysis/inputs";
import FactorTable, { type FactorRow, type Occurrence } from "./FactorTable";

/**
 * "무엇이 영향을 줄까" 탭 — outcomes 레지스트리를 읽어 결과를 고르고, 좋았던 날/나빴던 날의
 * 원인 후보를 나란히 보여준다. **상관·확률·결론을 계산하지 않는다.** 단순 빈도(N일 중 M일)만.
 * 화면 라벨은 판단어가 아니라 관찰 사실(goodLabel/badLabel). (기획서 §3, CLAUDE.md 원칙 6)
 */

const shortDay = (ymd: string) => {
  const [, m, d] = ymd.split("-");
  return `${Number(m)}/${Number(d)}`;
};

function DayChips({ days, cls }: { days: string[]; cls: string }) {
  if (days.length === 0) return <span className="text-[11px] text-gray-300">없음</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {days.map((d) => (
        <span key={d} className={`rounded px-1.5 py-0.5 text-[11px] ${cls}`}>
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
  events: InsightEvent[];
  periodDays: number;
  today: string;
  selectedId: string;
  period: DashboardPeriod;
}) {
  // 각 결과의 비교를 한 번씩 계산(버튼의 "N일" 표시 + 선택된 결과 상세에 재사용).
  const computed = OUTCOMES.map((o) => ({
    outcome: o,
    cmp: compareOutcome(o.id, events, periodDays, { today }),
  }));

  const selected = getOutcome(selectedId) ?? OUTCOMES[0]!;
  const current = computed.find((c) => c.outcome.id === selected.id)!;
  const cmp = current.cmp;
  const classifiedCount = (c: (typeof computed)[number]["cmp"]) =>
    c.goodDays.length + c.badDays.length;

  // 색: 좋음=청록, 나쁨=붉음(craving 은 옅은 호박). 판단 보류=회색.
  const goodChip = "bg-teal-50 text-teal-700";
  const badChip = selected.badMuted ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-700";

  return (
    <div className="flex flex-col gap-4">
      {/* 1. 결과 선택 — outcomes 레지스트리에서 자동 생성 */}
      <section className="flex flex-col gap-1">
        <h2 className="text-sm font-medium">무엇에 대해 볼까요?</h2>
        <div className="flex flex-wrap gap-2">
          {computed.map(({ outcome, cmp: c }) => {
            const active = outcome.id === selected.id;
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
                  · {classifiedCount(c)}일
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
          &lsquo;{selected.goodLabel}&rsquo; 은 &lsquo;말하지 않음&rsquo; 을 포함해요. 기록이 3건 이상인 날만 셌습니다.
        </p>
      )}

      {!cmp.enoughData ? (
        // 2-a. 데이터 부족 — 비교표 대신 지금까지 기록된 날을 보여준다(뭘 더 기록해야 하는지)
        <section className="flex flex-col gap-3">
          <p className="rounded-lg border border-gray-300 px-3 py-3 text-sm text-gray-700">
            <span className="text-teal-700">{selected.goodLabel}</span> {cmp.goodDays.length}일 /{" "}
            <span className={selected.badMuted ? "text-amber-700" : "text-rose-700"}>
              {selected.badLabel}
            </span>{" "}
            {cmp.badDays.length}일 — 비교하려면 각각 {cmp.minSamplesNeeded}일이 필요해요.
          </p>
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-teal-700">
                {selected.goodLabel} ({cmp.goodDays.length}일)
              </span>
              <DayChips days={cmp.goodDays} cls={goodChip} />
            </div>
            <div className="flex flex-col gap-1">
              <span className={`text-xs ${selected.badMuted ? "text-amber-700" : "text-rose-700"}`}>
                {selected.badLabel} ({cmp.badDays.length}일)
              </span>
              <DayChips days={cmp.badDays} cls={badChip} />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-gray-400">
                아직 판단 못 한 날 ({cmp.unknownDays.length}일) — 결과 기록이 없거나 부족한 날
              </span>
              <DayChips days={cmp.unknownDays} cls="bg-gray-100 text-gray-500" />
            </div>
          </div>
        </section>
      ) : (
        // 2-b. 데이터 충분 — 원인 후보 비교표 + 인라인 상세
        <FactorTable
          rows={buildFactorRows(selected, cmp, events)}
          goodTotal={cmp.goodDays.length}
          badTotal={cmp.badDays.length}
          goodLabel={selected.goodLabel}
          badLabel={selected.badLabel}
          badMuted={!!selected.badMuted}
          effectLabel={selected.label}
          showValues={selected.kind === "scale"}
        />
      )}
    </div>
  );
}

/**
 * 비교표 상위 10행에 인라인 상세 데이터를 붙인다. **LLM 호출 없이** 원문·요약·결과값만 모은다.
 * (difference 내림차순 상위 10 — difference 는 정렬용, 화면엔 노출하지 않는다)
 */
function buildFactorRows(
  selected: (typeof OUTCOMES)[number],
  cmp: ReturnType<typeof compareOutcome>,
  events: InsightEvent[],
): FactorRow[] {
  // 분류된 날마다: 그날의 결과 요약/값(상세의 outcomeSummary·결과값 목록) + lookback 창.
  const info = new Map<string, { summary: string; value: number | null }>();
  const windowByDate = new Map<string, InsightEvent[]>();
  for (const cd of cmp.classified) {
    const dayOutcome = events.filter(
      (e) => e.category === selected.category && kstDateOf(e.occurred_at) === cd.date,
    );
    let summary = "";
    let value: number | null = null;
    if (selected.kind === "scale") {
      const vals = dayOutcome
        .map((e) => readScaleValue(selected, e.payload))
        .filter((v): v is number => v != null);
      value = vals.length ? Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 10) / 10 : null;
      const latest = [...dayOutcome].sort(
        (a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at),
      )[0];
      summary = latest ? summarizeEvent(latest.category, latest.payload) : "";
    } else {
      const matching = dayOutcome.filter((e) => selected.match(e.payload));
      summary =
        cd.group === "bad" && matching[0]
          ? summarizeEvent(matching[0].category, matching[0].payload)
          : "해당 없음";
    }
    info.set(cd.date, { summary, value });
    windowByDate.set(
      cd.date,
      events.filter((e) => withinLookback(e.occurred_at, cd.anchor, selected.lookbackHours)),
    );
  }

  const inputById = new Map(extractInputFactors(events).map((f) => [f.id, f]));
  const top = [...cmp.factors].sort((a, b) => b.difference - a.difference).slice(0, 10);

  return top.map((fc) => {
    const inp = inputById.get(fc.id)!;
    const occurrences: Occurrence[] = [];
    for (const cd of cmp.classified) {
      const matched = inp.select(windowByDate.get(cd.date) ?? []);
      if (matched.length === 0) continue;
      occurrences.push({
        date: cd.date,
        group: cd.group,
        outcomeSummary: info.get(cd.date)!.summary,
        events: (matched as InsightEvent[]).map((e) => ({
          time: formatWhen(e.occurred_at, e.occurred_at_precision),
          summary: summarizeEvent(e.category, e.payload),
          transcript: e.transcript,
          recordedDate: kstDateOf(e.recorded_at),
        })),
      });
    }
    occurrences.sort((a, b) => a.date.localeCompare(b.date));

    // 전체 기간 등장 집계(분류 여부 무관).
    const appearDates = [
      ...new Set(inp.select(events).map((e) => kstDateOf(e.occurred_at))),
    ].sort();
    const outcomeValues = occurrences
      .map((o) => info.get(o.date)!.value)
      .filter((v): v is number => v != null);

    return {
      id: fc.id,
      label: fc.label,
      goodCount: fc.goodCount,
      badCount: fc.badCount,
      appearCount: appearDates.length,
      firstDay: appearDates[0] ?? null,
      lastDay: appearDates[appearDates.length - 1] ?? null,
      outcomeValues,
      occurrences,
    };
  });
}
