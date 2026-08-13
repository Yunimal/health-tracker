import { redirect } from "next/navigation";
import { getDayTimeline, todayKstDate } from "@/lib/db/queries";
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
  const user = await currentWebUser();
  if (!user) redirect("/login");

  const sp = await searchParams;
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : todayKstDate();
  const showHidden = sp.showHidden === "1";
  const timeline = await getDayTimeline(user.id, date, showHidden);

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
