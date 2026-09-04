import Link from "next/link";
import { redirect } from "next/navigation";
import { currentWebUser } from "@/lib/auth";
import { getThings, getThingRejectionPairs } from "@/lib/db/queries";
import { findMergeCandidates } from "@/lib/parser/thing-extract";
import UserBar from "@/app/_components/UserBar";
import ThingsClient from "./_components/ThingsClient";

// DB 에 의존하는 동적 페이지.
export const dynamic = "force-dynamic";

export default async function ThingsPage() {
  const user = await currentWebUser();
  if (!user) redirect("/login");

  const [things, rejectedPairs] = await Promise.all([
    getThings(user.id),
    getThingRejectionPairs(user.id),
  ]);

  const candidates = findMergeCandidates(things, rejectedPairs);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      <header className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">대상</h1>
          <UserBar label={user.label} />
        </div>
        <Link href="/" className="self-start text-sm text-gray-500 hover:text-gray-700">
          ← 오늘의 기록
        </Link>
      </header>

      <ThingsClient things={things} candidates={candidates} />
    </main>
  );
}
