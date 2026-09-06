import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { currentWebUser } from "@/lib/auth";
import { getThingDetail, getEventsForAnalysis } from "@/lib/db/queries";
import { relativeDay } from "@/lib/format";
import { normalize } from "@/lib/parser/thing-extract";
import { compareThingOutcomes, THING_MIN_SAMPLES } from "@/lib/analysis/thing-compare";
import type { ThingOutcomeRow } from "@/lib/analysis/thing-compare";
import UserBar from "../../_components/UserBar";
import NoteEditor from "./_components/NoteEditor";
import ThingTrendChart from "./_components/ThingTrendChart";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  treatment: "시술",
  product: "제품",
  place: "장소",
  regimen: "루틴",
};
const KIND_COLOR: Record<string, string> = {
  treatment: "border-indigo-200 bg-indigo-50 text-indigo-700",
  product: "border-blue-200 bg-blue-50 text-blue-700",
  place: "border-green-200 bg-green-50 text-green-700",
  regimen: "border-orange-200 bg-orange-50 text-orange-700",
};
const HYP_STATUS_LABEL: Record<string, string> = {
  open: "미결",
  supported: "지지됨",
  not_supported: "반박됨",
  dismissed: "기각",
};
const TIME_LABEL: Record<string, string> = {
  morning: "오전",
  lunch: "점심",
  afternoon: "오후",
  evening: "저녁",
  night: "밤",
};
const TIME_KEYS = ["morning", "lunch", "afternoon", "evening", "night"] as const;

// ── 결과 행 렌더 ─────────────────────────────────────────────────────────────

function OutcomeRow({ row }: { row: ThingOutcomeRow }) {
  const { outcome, groupA, groupB, enoughData } = row;

  // 양쪽 모두 데이터가 전혀 없는 결과는 숨긴다.
  const aHasData =
    outcome.kind === "scale" ? groupA.withOutcome > 0 : groupA.presenceCount > 0 || groupA.total > 0;
  const bHasData =
    outcome.kind === "scale" ? groupB.withOutcome > 0 : groupB.presenceCount > 0 || groupB.total > 0;
  if (groupA.total === 0 && groupB.total === 0) return null;

  const dim = !enoughData;

  function scaleCell(stats: typeof groupA) {
    if (stats.total === 0)
      return <span className="text-gray-300">—</span>;
    if (stats.withOutcome === 0)
      return <span className="text-gray-400">데이터 없음</span>;
    return (
      <>
        <span className="font-medium">{stats.mean}</span>
        <span className="ml-1 text-[11px] text-gray-400">({stats.withOutcome}일)</span>
      </>
    );
  }

  function presenceCell(stats: typeof groupA) {
    if (stats.total === 0)
      return <span className="text-gray-300">—</span>;
    return (
      <>
        <span className="font-medium">{stats.presenceCount}</span>
        <span className="text-gray-400">/{stats.total}일</span>
      </>
    );
  }

  return (
    <div
      className={`grid grid-cols-[1fr_1fr_1fr] gap-x-3 rounded-lg border px-3 py-2 text-sm ${
        dim ? "border-gray-100 text-gray-400" : "border-gray-200"
      }`}
    >
      <span className={dim ? "" : "text-gray-700"}>
        {outcome.label}
        {dim && (
          <span className="ml-1 text-[10px] text-gray-300">표본 부족</span>
        )}
      </span>

      {outcome.kind === "scale" ? (
        <>
          <span>
            {groupA.label && <span className="mr-1 text-[11px] text-gray-400">{groupA.label}</span>}
            {scaleCell(groupA)}
          </span>
          <span>
            {groupB.label && <span className="mr-1 text-[11px] text-gray-400">{groupB.label}</span>}
            {scaleCell(groupB)}
          </span>
        </>
      ) : (
        <>
          <span>
            {groupA.label && <span className="mr-1 text-[11px] text-gray-400">{groupA.label}</span>}
            {presenceCell(groupA)}
          </span>
          <span>
            {groupB.label && <span className="mr-1 text-[11px] text-gray-400">{groupB.label}</span>}
            {presenceCell(groupB)}
          </span>
        </>
      )}
    </div>
  );
}

// ── 페이지 ────────────────────────────────────────────────────────────────────

export default async function ThingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await currentWebUser();
  if (!user) redirect("/login");

  const { id } = await params;

  const [detail, { events, periodDays, today }] = await Promise.all([
    getThingDetail(user.id, id),
    getEventsForAnalysis(user.id, "all"),
  ]);
  if (!detail) notFound();

  const { thing: t, mentions, relatedHypotheses } = detail;

  // thing 이름 정규화 집합
  const normNames = new Set([t.name, ...t.aliases].map((n) => normalize(n)));

  const cmp = compareThingOutcomes(events, normNames, periodDays, today);

  const firstSeen = cmp.firstUseDate ? relativeDay(cmp.firstUseDate) : null;
  const lastSeen = cmp.lastUseDate ? relativeDay(cmp.lastUseDate) : null;

  // 시간대 분포 — 최댓값으로 막대 길이 계산
  const timeMax = Math.max(
    ...TIME_KEYS.map((k) => cmp.timeDistribution[k]),
    1,
  );

  // 하루 평균 횟수 (소수점 1자리)
  const avgPerDay =
    cmp.useDayCount > 0
      ? Math.round((cmp.totalEventCount / cmp.useDayCount) * 10) / 10
      : 0;

  // 결과 행 필터 (양쪽 total 이 모두 0인 것 제외 — OutcomeRow 내부도 필터하지만 헤더 표시용)
  const visibleRows = cmp.outcomeRows.filter(
    (r) => r.groupA.total > 0 || r.groupB.total > 0,
  );

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-4 pb-12">

      {/* ── 헤더 ─────────────────────────────────────────────────── */}
      <header className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <Link href="/things" className="text-sm text-gray-500 hover:text-gray-700">
            ← 대상 목록
          </Link>
          <UserBar label={user.label} />
        </div>

        <div className="rounded-lg border border-gray-200 px-4 py-3">
          <div className="flex flex-wrap items-baseline gap-2">
            <h1 className="text-lg font-semibold">{t.name}</h1>
            <span className={`inline-block rounded border px-1.5 py-0 text-[10px] ${KIND_COLOR[t.kind] ?? ""}`}>
              {KIND_LABEL[t.kind] ?? t.kind}
            </span>
          </div>
          {t.aliases.length > 0 && (
            <p className="mt-0.5 text-[11px] text-gray-400">= {t.aliases.join(", ")}</p>
          )}
        </div>
      </header>

      {/* ── 1. 요약 집계 ──────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-gray-700">요약</h2>

        {/* 수치 한 줄 */}
        <div className="flex flex-wrap gap-x-5 gap-y-1 rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 text-sm">
          <span>
            <span className="font-medium">{cmp.totalEventCount}</span>
            <span className="ml-1 text-gray-500">회</span>
          </span>
          <span>
            <span className="font-medium">{cmp.useDayCount}</span>
            <span className="ml-1 text-gray-500">일 사용</span>
            {cmp.totalPeriodDays > 0 && (
              <span className="ml-1 text-[11px] text-gray-400">
                (전체 {cmp.totalPeriodDays}일 중)
              </span>
            )}
          </span>
          {cmp.useDayCount > 0 && (
            <span>
              <span className="font-medium">{avgPerDay}</span>
              <span className="ml-1 text-gray-500">회/일(평균)</span>
            </span>
          )}
          {firstSeen && (
            <span className="text-gray-500">
              처음 <span className="font-medium text-gray-800">{firstSeen}</span>
            </span>
          )}
          {lastSeen && lastSeen !== firstSeen && (
            <span className="text-gray-500">
              마지막 <span className="font-medium text-gray-800">{lastSeen}</span>
            </span>
          )}
        </div>

        {/* 시간대 분포 */}
        {cmp.totalEventCount > 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="text-[11px] text-gray-400">시간대 분포</p>
            <div className="flex flex-col gap-1">
              {TIME_KEYS.map((k) => {
                const v = cmp.timeDistribution[k];
                const pct = Math.round((v / timeMax) * 100);
                return (
                  <div key={k} className="flex items-center gap-2">
                    <span className="w-8 shrink-0 text-right text-[11px] text-gray-400">
                      {TIME_LABEL[k]}
                    </span>
                    <div className="h-3 flex-1 overflow-hidden rounded-full bg-gray-100">
                      <div
                        className="h-full rounded-full bg-gray-700"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-6 text-[11px] text-gray-500">{v}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 양 표현 분포 */}
        {cmp.amountTexts.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="text-[11px] text-gray-400">양 표현</p>
            <p className="text-sm text-gray-700">
              {cmp.amountTexts.map((a, i) => (
                <span key={a.text}>
                  {i > 0 && <span className="mx-1.5 text-gray-300">·</span>}
                  {a.text}
                  <span className="ml-0.5 text-[11px] text-gray-400">{a.count}회</span>
                </span>
              ))}
            </p>
          </div>
        )}
      </section>

      {/* ── 2. 사용 빈도 추이 ─────────────────────────────────────── */}
      {cmp.totalEventCount > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-gray-700">
            사용 빈도 추이
            <span className="ml-1 text-[11px] font-normal text-gray-400">
              (짙은 막대 = 2회 이상)
            </span>
          </h2>
          <ThingTrendChart dailyCounts={cmp.dailyCounts} />
        </section>
      )}

      {/* ── 3. 결과별 비교 ────────────────────────────────────────── */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-gray-700">결과별 비교</h2>

        {cmp.axisMode === "insufficient" ? (
          <p className="rounded-lg border border-gray-100 px-3 py-4 text-center text-sm text-gray-400">
            아직 비교하기 이릅니다 ({cmp.useDayCount}일)
            <span className="mt-0.5 block text-[11px]">
              {THING_MIN_SAMPLES}일 이상 기록되면 비교할 수 있어요.
            </span>
          </p>
        ) : (
          <>
            {cmp.axisSwitchReason && (
              <p className="text-[11px] text-gray-400">{cmp.axisSwitchReason}</p>
            )}

            {/* 컬럼 헤더 */}
            <div className="grid grid-cols-[1fr_1fr_1fr] gap-x-3 px-3 text-[11px] text-gray-400">
              <span>결과</span>
              <span>{cmp.groupALabel}</span>
              <span>{cmp.groupBLabel}</span>
            </div>

            <div className="flex flex-col gap-1.5">
              {visibleRows.map((row) => (
                <OutcomeRow key={row.outcome.id} row={row} />
              ))}
              {visibleRows.length === 0 && (
                <p className="py-4 text-center text-sm text-gray-400">
                  비교할 결과 데이터가 없습니다.
                </p>
              )}
            </div>
          </>
        )}
      </section>

      {/* ── 4. 관련 가설 ─────────────────────────────────────────── */}
      {relatedHypotheses.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-gray-700">관련 가설</h2>
          <ul className="flex flex-col gap-1.5">
            {relatedHypotheses.map((h) => (
              <li key={h.id}>
                <Link
                  href={`/hypotheses/${h.id}`}
                  className="flex items-start justify-between gap-2 rounded-lg border border-gray-200 px-3 py-2 hover:border-gray-300"
                >
                  <span className="text-sm">{h.statement}</span>
                  <span className="shrink-0 rounded border border-gray-200 px-1.5 py-0 text-[10px] text-gray-500">
                    {HYP_STATUS_LABEL[h.status] ?? h.status}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── 5. 사용 이력 (접어두기) ───────────────────────────────── */}
      {mentions.length > 0 && (
        <details className="group rounded-lg border border-gray-200">
          <summary className="flex cursor-pointer select-none items-center justify-between px-4 py-3 text-sm font-medium text-gray-700">
            <span>사용 이력 ({mentions.length}건)</span>
            <span className="text-gray-400 group-open:rotate-180 transition-transform">▾</span>
          </summary>
          <ul className="divide-y divide-gray-100 px-4 pb-2">
            {mentions.map((m) => (
              <li key={m.id} className="flex items-baseline justify-between gap-3 py-2">
                <span className="text-[11px] text-gray-400 shrink-0">
                  {m.recorded_at ? relativeDay(m.recorded_at) : "날짜 미상"}
                </span>
                <span className="flex-1 truncate text-sm text-gray-700">
                  {m.excerpt ?? ""}
                </span>
                {m.kst_date && (
                  <Link
                    href={`/?date=${m.kst_date}`}
                    className="shrink-0 text-[11px] text-gray-400 hover:text-gray-600 hover:underline"
                  >
                    원문 보기 →
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* ── 6. 메모 ──────────────────────────────────────────────── */}
      <section className="flex flex-col gap-1.5">
        <h2 className="text-sm font-medium text-gray-700">메모</h2>
        <NoteEditor thingId={t.id} initialNote={t.note} />
      </section>

    </main>
  );
}
