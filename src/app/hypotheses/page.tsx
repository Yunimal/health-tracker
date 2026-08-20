import Link from "next/link";
import { redirect } from "next/navigation";
import { getHypotheses } from "@/lib/db/queries";
import { currentWebUser } from "@/lib/auth";
import type { Hypothesis } from "@/lib/db/schema";
import UserBar from "../_components/UserBar";
import HypothesisItem from "./_components/HypothesisItem";
import ResolvedList from "./_components/ResolvedList";

// DB 에 의존하는 동적 페이지. 프리렌더하지 않는다.
export const dynamic = "force-dynamic";

/** open 정렬: mention_count 내림차순, 같으면 최근순(created_at 내림차순). */
function sortOpen(a: Hypothesis, b: Hypothesis): number {
  if (b.mention_count !== a.mention_count) return b.mention_count - a.mention_count;
  return b.created_at.localeCompare(a.created_at);
}

export default async function HypothesesPage() {
  const user = await currentWebUser();
  if (!user) redirect("/login");

  const all = await getHypotheses(user.id);
  const open = all.filter((h) => h.status === "open").sort(sortOpen);
  // 정한 가설은 하단 보관함으로. 최근에 정한 순으로(created_at 내림차순 근사).
  const resolved = all
    .filter((h) => h.status !== "open")
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      <header className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">가설</h1>
          <UserBar label={user.label} />
        </div>
        <Link href="/" className="self-start text-sm text-gray-500 hover:text-gray-700">
          ← 오늘의 기록
        </Link>
      </header>

      {open.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-400">아직 살펴볼 가설이 없습니다.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {open.map((h) => (
            <HypothesisItem key={h.id} h={h} />
          ))}
        </ul>
      )}

      <ResolvedList items={resolved} />
    </main>
  );
}
