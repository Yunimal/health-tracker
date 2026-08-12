import { getDayTimeline, todayKstDate } from "@/lib/db/queries";
import TextEntryForm from "./_components/TextEntryForm";
import DateNav from "./_components/DateNav";
import EntryCard from "./_components/EntryCard";

// DB/searchParams 에 의존하는 동적 페이지. 프리렌더하지 않는다.
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const sp = await searchParams;
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : todayKstDate();
  const timeline = await getDayTimeline(date);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      <header className="flex flex-col gap-3">
        <h1 className="text-lg font-semibold">오늘의 기록</h1>
        <TextEntryForm />
        <div className="flex items-center justify-between">
          <DateNav date={date} />
          <span className="text-xs text-gray-500">{timeline.length}건</span>
        </div>
      </header>

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
