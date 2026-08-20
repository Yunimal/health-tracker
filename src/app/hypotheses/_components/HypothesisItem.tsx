import Link from "next/link";
import type { Hypothesis } from "@/lib/db/schema";
import StatusButtons from "./StatusButtons";

/**
 * 가설 한 건. 누르면 상세(/hypotheses/[id])로. 아래에 상태 버튼.
 * 지시어 없는 공유 컴포넌트라 서버(목록)와 클라이언트(보관함) 양쪽에서 쓴다.
 * 최초 표현(statement)을 크게, 최근 표현이 다르면 작게 덧붙인다. 판단하는 말은 붙이지 않는다.
 */
export default function HypothesisItem({ h }: { h: Hypothesis }) {
  const recentDiffers = !!h.recent_statement && h.recent_statement.trim() !== h.statement.trim();

  return (
    <li className="rounded-lg border border-gray-300">
      <Link
        href={`/hypotheses/${h.id}`}
        className="block rounded-t-lg px-3 pb-1 pt-2 hover:bg-gray-50"
      >
        <p className="text-base leading-relaxed">“{h.statement}”</p>
        {recentDiffers && (
          <p className="mt-0.5 text-xs text-gray-400">최근엔 “{h.recent_statement}”</p>
        )}
        {(h.cause_hint || h.effect_hint) && (
          <p className="mt-1 text-[11px] text-gray-400">
            {h.cause_hint ?? "?"} → {h.effect_hint ?? "?"}
          </p>
        )}
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 px-3 py-2">
        <span className="text-[11px] text-gray-500">{h.mention_count}번 의심함</span>
        <StatusButtons id={h.id} status={h.status} />
      </div>
    </li>
  );
}
