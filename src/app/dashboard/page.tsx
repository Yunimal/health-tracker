import Link from "next/link";
import { redirect } from "next/navigation";
import { currentWebUser } from "@/lib/auth";
import { getDashboardData, getEventsForAnalysis, getThings, type DashboardPeriod } from "@/lib/db/queries";
import UserBar from "../_components/UserBar";
import InsightsTab from "./_components/InsightsTab";
import RecordsTab from "./_components/RecordsTab";

// DB/searchParams 에 의존하는 동적 페이지. 프리렌더하지 않는다.
export const dynamic = "force-dynamic";

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

type Tab = "insights" | "records";
const TAB_LABEL: Record<Tab, string> = {
  insights: "무엇이 영향을 줄까",
  records: "기록 현황",
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; tab?: string; outcome?: string }>;
}) {
  const user = await currentWebUser();
  if (!user) redirect("/login");

  const sp = await searchParams;
  const period = parsePeriod(sp.days);
  const tab: Tab = sp.tab === "records" ? "records" : "insights"; // 기본 탭 = insights

  // 탭에 필요한 데이터만 가져온다. insights 는 lookback 버퍼 포함, records 는 기간 그대로.
  let content;
  if (tab === "insights") {
    const [{ events, periodDays, today }, things] = await Promise.all([
      getEventsForAnalysis(user.id, period),
      getThings(user.id),
    ]);
    content = (
      <InsightsTab
        events={events}
        periodDays={periodDays}
        today={today}
        selectedId={sp.outcome ?? ""}
        period={period}
        things={things}
      />
    );
  } else {
    const { dates, events } = await getDashboardData(user.id, period);
    content = <RecordsTab dates={dates} events={events} />;
  }

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      <header className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">대시보드</h1>
          <UserBar label={user.label} />
        </div>
        <Link href="/" className="self-start text-sm text-gray-500 hover:text-gray-700">
          ← 오늘의 기록
        </Link>

        {/* 탭 */}
        <div className="flex gap-1 border-b border-gray-200">
          {(["insights", "records"] as Tab[]).map((t) => (
            <Link
              key={t}
              href={`/dashboard?tab=${t}&days=${period}`}
              className={
                tab === t
                  ? "-mb-px border-b-2 border-gray-900 px-3 py-2 text-sm font-medium text-gray-900"
                  : "-mb-px border-b-2 border-transparent px-3 py-2 text-sm text-gray-500 hover:text-gray-700"
              }
            >
              {TAB_LABEL[t]}
            </Link>
          ))}
        </div>

        {/* 기간 선택 (두 탭 공통) */}
        <div className="flex items-center gap-2">
          {PERIODS.map((p) => (
            <Link
              key={String(p.value)}
              href={`/dashboard?tab=${tab}&days=${p.value}`}
              className={
                p.value === period
                  ? "rounded-full bg-gray-900 px-3 py-0.5 text-xs text-white"
                  : "rounded-full border border-gray-300 px-3 py-0.5 text-xs text-gray-600 hover:bg-gray-50"
              }
            >
              {p.label}
            </Link>
          ))}
        </div>
      </header>

      {content}
    </main>
  );
}
