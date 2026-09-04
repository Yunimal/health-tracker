import Link from "next/link";
import { redirect } from "next/navigation";
import { getDayTimeline, getOpenHypothesisCount, getThingCount, todayKstDate } from "@/lib/db/queries";
import { currentWebUser } from "@/lib/auth";
import TextEntryForm from "./_components/TextEntryForm";
import DateNav from "./_components/DateNav";
import EntryCard from "./_components/EntryCard";
import ShowHiddenToggle from "./_components/ShowHiddenToggle";
import UserBar from "./_components/UserBar";
import PendingPoller from "./_components/PendingPoller";

// DB/searchParams 에 의존하는 동적 페이지. 프리렌더하지 않는다.
export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; showHidden?: string }>;
}) {
  // [perf] 계측: 서버 렌더의 데이터 페칭 단계별 소요 시간을 Vercel Logs 로 찍는다.
  // auth 는 currentWebUser() — 토큰→사용자 조회(60초 캐시). 캐시 미스면 app_users 왕복 1회 추가.
  const tStart = performance.now();

  const user = await currentWebUser();
  const tAuth = performance.now() - tStart;
  if (!user) redirect("/login");

  const sp = await searchParams;
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : todayKstDate();
  const showHidden = sp.showHidden === "1";
  const tTimeline0 = performance.now();
  // 타임라인과 "가설 N개" 카운트를 병렬로 가져온다(순차 왕복 방지).
  const [timeline, openHypothesisCount, thingCount] = await Promise.all([
    getDayTimeline(user.id, date, showHidden),
    getOpenHypothesisCount(user.id),
    getThingCount(user.id),
  ]);
  const tTimeline = performance.now() - tTimeline0;

  console.log(
    `[perf] page date=${date} auth=${tAuth.toFixed(0)}ms timeline=${tTimeline.toFixed(0)}ms` +
      ` render_total=${(performance.now() - tStart).toFixed(0)}ms`,
  );

  // 아직 파싱되지 않은(정리 중) 원문. 있으면 클라이언트가 몇 번 폴링해 결과를 채운다.
  const pendingIds = timeline
    .filter((d) => d.entry.parsed_at == null && d.entry.parse_error == null)
    .map((d) => d.entry.id)
    .sort();

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      <header className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">오늘의 기록</h1>
          <UserBar label={user.label} />
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/hypotheses"
            className="rounded-full border border-gray-300 px-3 py-0.5 text-xs text-gray-600 hover:bg-gray-50"
          >
            가설 {openHypothesisCount}개 ›
          </Link>
          <Link
            href="/dashboard"
            className="rounded-full border border-gray-300 px-3 py-0.5 text-xs text-gray-600 hover:bg-gray-50"
          >
            대시보드 ›
          </Link>
          {thingCount > 0 && (
            <Link
              href="/things"
              className="rounded-full border border-gray-300 px-3 py-0.5 text-xs text-gray-600 hover:bg-gray-50"
            >
              대상 {thingCount}개 ›
            </Link>
          )}
        </div>
        <TextEntryForm />
        <div className="flex items-center justify-between">
          <DateNav date={date} />
          <div className="flex items-center gap-3">
            <ShowHiddenToggle date={date} showHidden={showHidden} />
            <span className="text-xs text-gray-500">{timeline.length}건</span>
          </div>
        </div>
      </header>

      {pendingIds.length > 0 && <PendingPoller key={pendingIds.join(",")} />}

      {timeline.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-400">이 날짜의 기록이 없습니다.</p>
      ) : (
        <section className="flex flex-col gap-3">
          {timeline.map((data) => (
            <EntryCard key={data.entry.id} data={data} />
          ))}
        </section>
      )}
    </main>
  );
}
