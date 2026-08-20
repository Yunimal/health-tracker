import { CATEGORY_ICON, CATEGORY_LABEL, formatWhen, summarizeEvent } from "@/lib/format";
import type { TimelineEvent } from "@/lib/db/queries";

/** cause 기준 상대 시각을 말로. 양수면 "뒤", 음수면 "전". (판단 없이 시간차만) */
function relativeGap(deltaMs: number): string {
  const after = deltaMs >= 0;
  const abs = Math.abs(deltaMs);
  const suffix = after ? "뒤" : "전";
  const mins = Math.round(abs / 60000);
  if (mins < 60) return `${mins}분 ${suffix}`;
  const hours = Math.round(abs / 3600000);
  return `${hours}시간 ${suffix}`;
}

/**
 * 이벤트 한 줄(아이콘 · 요약 · 카테고리 · 시각). 원문 요약(summarizeEvent)만 보여주고
 * 판단 라벨은 붙이지 않는다. deltaMs 를 주면 cause 기준 상대 시각을 덧붙인다.
 */
export default function EventLine({
  event,
  deltaMs,
}: {
  event: TimelineEvent;
  deltaMs?: number;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="shrink-0 text-sm leading-5" aria-hidden>
        {CATEGORY_ICON[event.category]}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm">{summarizeEvent(event.category, event.payload)}</span>
        <span className="block text-[11px] text-gray-400">
          {CATEGORY_LABEL[event.category]} · {formatWhen(event.occurred_at, event.occurred_at_precision)}
          {deltaMs !== undefined && <span className="ml-1 text-gray-500">({relativeGap(deltaMs)})</span>}
        </span>
      </span>
    </div>
  );
}
