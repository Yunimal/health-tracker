import Link from "next/link";
import { redirect } from "next/navigation";
import { currentWebUser } from "@/lib/auth";
import { getDashboardData, type DashboardPeriod } from "@/lib/db/queries";
import { CATEGORY_ICON, CATEGORY_LABEL, relativeDay, summarizeEvent } from "@/lib/format";
import type { Category } from "@/lib/db/schema";
import UserBar from "../_components/UserBar";
import Heatmap from "./_components/Heatmap";
import MiniChart, { type ChartPoint } from "./_components/MiniChart";

// DB/searchParams 에 의존하는 동적 페이지. 프리렌더하지 않는다.
export const dynamic = "force-dynamic";

// 히트맵/요약 카드에 쓰는 카테고리 순서(12개). 기획서 §5.3 순서.
const CATEGORIES: Category[] = [
  "food",
  "mood",
  "sleep",
  "energy",
  "menstrual",
  "bowel",
  "medication",
  "activity",
  "appetite",
  "digestion",
  "body_condition",
  "body_care",
];

const num = (p: Record<string, unknown>, k: string): number | null =>
  typeof p[k] === "number" ? (p[k] as number) : null;

// [2] 숫자 추이 — 이미 숫자인 필드만. 없는 값은 점을 찍지 않는다(추세 착시 방지).
interface NumericField {
  label: string;
  category: Category;
  extract: (p: Record<string, unknown>) => number | null;
  yMin: number;
  yMax: number;
  yTop: string;
  yBottom: string;
}
const NUMERIC_FIELDS: NumericField[] = [
  { label: "수면 질", category: "sleep", extract: (p) => num(p, "quality"), yMin: 1, yMax: 5, yTop: "5", yBottom: "1" },
  { label: "기력", category: "energy", extract: (p) => num(p, "level"), yMin: 1, yMax: 5, yTop: "5", yBottom: "1" },
  { label: "기분 (긍·부정)", category: "mood", extract: (p) => num(p, "valence"), yMin: -2, yMax: 2, yTop: "+2", yBottom: "-2" },
  { label: "배변 형태 (브리스톨)", category: "bowel", extract: (p) => num(p, "bristol"), yMin: 1, yMax: 7, yTop: "7", yBottom: "1" },
  { label: "생리통", category: "menstrual", extract: (p) => num(p, "pain"), yMin: 1, yMax: 5, yTop: "5", yBottom: "1" },
  {
    label: "몸 상태 자가 점수",
    category: "body_condition",
    // rating_scale 로 정규화해 0~1. 둘 중 하나라도 없으면 점을 찍지 않는다. (R23)
    extract: (p) => {
      const r = num(p, "self_rating");
      const s = num(p, "rating_scale");
      return r != null && s != null && s > 0 ? r / s : null;
    },
    yMin: 0,
    yMax: 1,
    yTop: "만점",
    yBottom: "0",
  },
];

const MIN_POINTS = 5; // 이 미만이면 차트를 그리지 않는다(사용자 지시 [2])

const PERIODS: { value: DashboardPeriod; label: string }[] = [
  { value: 7, label: "7일" },
  { value: 14, label: "14일" },
  { value: 30, label: "30일" },
  { value: "all", label: "전체" },
];

function parsePeriod(raw: string | undefined): DashboardPeriod {
  if (raw === "7") return 7;
  if (raw === "30") return 30;
  if (raw === "all") return "all";
  return 14; // 기본
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const user = await currentWebUser();
  if (!user) redirect("/login");

  const sp = await searchParams;
  const period = parsePeriod(sp.days);
  const { dates, events } = await getDashboardData(user.id, period);

  // 차트 x축 범위(기간 전체). 점은 occurred_at 시각으로 찍는다.
  const tStart = Date.parse(`${dates[0]}T00:00:00+09:00`);
  const tEnd = Date.parse(`${dates[dates.length - 1]!}T23:59:59+09:00`);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-4">
      <header className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">대시보드</h1>
          <UserBar label={user.label} />
        </div>
        <Link href="/" className="self-start text-sm text-gray-500 hover:text-gray-700">
          ← 오늘의 기록
        </Link>
        {/* [4] 기간 선택 */}
        <div className="flex items-center gap-2">
          {PERIODS.map((p) => {
            const active = p.value === period;
            return (
              <Link
                key={String(p.value)}
                href={`/dashboard?days=${p.value}`}
                className={
                  active
                    ? "rounded-full bg-gray-900 px-3 py-0.5 text-xs text-white"
                    : "rounded-full border border-gray-300 px-3 py-0.5 text-xs text-gray-600 hover:bg-gray-50"
                }
              >
                {p.label}
              </Link>
            );
          })}
        </div>
      </header>

      {/* [1] 일별 히트맵 — 메인 */}
      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-medium">일별 기록</h2>
          <span className="text-[11px] text-gray-400">
            {dates.length}일 · 총 {events.length}건
          </span>
        </div>
        <Heatmap dates={dates} rows={CATEGORIES} events={events} />
      </section>

      {/* [2] 숫자 추이 */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">숫자 추이</h2>
        <p className="text-[11px] text-gray-400">
          이미 숫자인 항목만. 기록이 있는 시점에만 점을 찍습니다(없는 날은 잇지 않음).
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {NUMERIC_FIELDS.map((f) => {
            const points: ChartPoint[] = events
              .filter((e) => e.category === f.category)
              .map((e) => {
                const y = f.extract(e.payload);
                return y == null ? null : { t: Date.parse(e.occurred_at), y };
              })
              .filter((p): p is ChartPoint => p !== null);
            return (
              <div key={f.label} className="rounded-lg border border-gray-300 p-3">
                <div className="mb-1 flex items-baseline justify-between">
                  <span className="text-sm">{f.label}</span>
                  <span className="text-[11px] text-gray-400">기록 {points.length}건</span>
                </div>
                {points.length < MIN_POINTS ? (
                  <p className="py-4 text-center text-xs text-gray-400">
                    아직 기록이 적어요 ({points.length}건)
                  </p>
                ) : (
                  <MiniChart
                    points={points}
                    tStart={tStart}
                    tEnd={tEnd}
                    yMin={f.yMin}
                    yMax={f.yMax}
                    yTop={f.yTop}
                    yBottom={f.yBottom}
                  />
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* [3] 카테고리별 요약 카드 — 건수 0도 표시 */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">카테고리별</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {CATEGORIES.map((cat) => {
            const evs = events.filter((e) => e.category === cat);
            const last = evs[evs.length - 1]; // 오름차순이라 마지막이 최근
            return (
              <div key={cat} className="rounded-lg border border-gray-300 px-3 py-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm">
                    <span aria-hidden>{CATEGORY_ICON[cat]}</span> {CATEGORY_LABEL[cat]}
                  </span>
                  <span className="text-xs text-gray-500">{evs.length}건</span>
                </div>
                {last ? (
                  <p className="mt-1 truncate text-[11px] text-gray-500">
                    <span className="text-gray-400">{relativeDay(last.occurred_at)} · </span>
                    {summarizeEvent(last.category, last.payload)}
                  </p>
                ) : (
                  <p className="mt-1 text-[11px] text-gray-300">이 기간 기록 없음</p>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}
