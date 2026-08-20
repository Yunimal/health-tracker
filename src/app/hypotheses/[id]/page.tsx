import Link from "next/link";
import { redirect } from "next/navigation";
import { getHypothesisDetail } from "@/lib/db/queries";
import { currentWebUser } from "@/lib/auth";
import { relativeDay } from "@/lib/format";
import UserBar from "../../_components/UserBar";
import StatusButtons from "../_components/StatusButtons";
import EventLine from "../_components/EventLine";

// DB 에 의존하는 동적 페이지. 프리렌더하지 않는다.
export const dynamic = "force-dynamic";

export default async function HypothesisDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await currentWebUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const detail = await getHypothesisDetail(user.id, id);

  if (!detail) {
    return (
      <main className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
        <Link href="/hypotheses" className="self-start text-sm text-gray-500 hover:text-gray-700">
          ← 가설 목록
        </Link>
        <p className="py-8 text-center text-sm text-gray-400">가설을 찾지 못했습니다.</p>
      </main>
    );
  }

  const { hypothesis: h, occurrences, distinctDays, matchedNames } = detail;
  const recentDiffers = !!h.recent_statement && h.recent_statement.trim() !== h.statement.trim();

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      <header className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <Link href="/hypotheses" className="text-sm text-gray-500 hover:text-gray-700">
            ← 가설 목록
          </Link>
          <UserBar label={user.label} />
        </div>

        <div className="rounded-lg border border-gray-300 px-3 py-3">
          <p className="text-base leading-relaxed">“{h.statement}”</p>
          {recentDiffers && (
            <p className="mt-0.5 text-xs text-gray-400">최근엔 “{h.recent_statement}”</p>
          )}
          {(h.cause_hint || h.effect_hint) && (
            <p className="mt-1 text-[11px] text-gray-400">
              {h.cause_hint ?? "?"} → {h.effect_hint ?? "?"}
            </p>
          )}
          <p className="mt-1 text-[11px] text-gray-500">{h.mention_count}번 의심함</p>
          <div className="mt-2 border-t border-gray-100 pt-2">
            <StatusButtons id={h.id} status={h.status} />
          </div>
        </div>
      </header>

      {/* 표본 수는 항상 함께 표시한다. 계산·결론은 하지 않는다 — 나란히 보여주기만 한다. */}
      <section className="flex flex-col gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-medium">나란히 보기</h2>
          <p className="text-[11px] text-gray-500">
            “{h.cause_hint ?? h.statement}” 과(와) 이름이 겹치는 기록: {occurrences.length}번
            {" · "}이 조건에 해당하는 날: {distinctDays}일
          </p>
          {matchedNames.length > 0 && (
            <p className="text-[11px] text-gray-400">겹친 이름: {matchedNames.join(", ")}</p>
          )}
          <p className="text-[11px] text-gray-400">
            왼쪽은 원인 후보, 오른쪽은 전후 12시간 안에 일어난 다른 기록입니다. 패턴 판단은 직접
            하세요.
          </p>
        </div>

        {occurrences.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-400">
            {h.cause_hint
              ? "이름이 겹치는 기록이 아직 없습니다."
              : "원인 힌트가 없어 이어볼 기록을 찾지 못했습니다."}
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {occurrences.map(({ cause, around }, i) => (
              <li
                key={cause.id + i}
                className="grid grid-cols-2 gap-3 rounded-lg border border-gray-300 p-3"
              >
                {/* 좌: 원인 후보 */}
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] text-gray-400">
                    원인 후보 · {relativeDay(cause.occurred_at)}
                  </span>
                  <EventLine event={cause} />
                </div>

                {/* 우: 그 전후에 일어난 일 */}
                <div className="flex flex-col gap-2 border-l border-gray-100 pl-3">
                  <span className="text-[11px] text-gray-400">전후 12시간</span>
                  {around.length === 0 ? (
                    <span className="text-xs text-gray-400">다른 기록 없음</span>
                  ) : (
                    around.map((a) => <EventLine key={a.id} event={a} deltaMs={a.delta_ms} />)
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
