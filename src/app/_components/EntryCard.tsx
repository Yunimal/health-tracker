import type { TimelineData } from "@/lib/db/queries";
import { formatDayTime, sourceLabel } from "@/lib/format";
import EventItem from "./EventItem";
import ReparseButton from "./ReparseButton";
import HideRestoreButton from "./HideRestoreButton";

/** 원문 1건 + 거기서 나온 events / hypotheses / unparsed. 원문을 크게, 파싱 결과는 그 아래 작게. */
export default function EntryCard({ data }: { data: TimelineData }) {
  const { entry, events, hypotheses, unparsed } = data;
  const hidden = entry.hidden_at != null;

  return (
    <article className={`rounded-lg border border-gray-300 ${hidden ? "opacity-50" : ""}`}>
      <header className="flex items-center justify-between gap-2 px-3 pt-2">
        <span className="text-[11px] text-gray-400">
          {formatDayTime(entry.recorded_at)} · {sourceLabel(entry.source)}
          {hidden && <span className="ml-1 text-gray-400">· 숨김</span>}
          {entry.parse_error && <span className="ml-1 text-amber-700">· 파싱 오류</span>}
          {!entry.parsed_at && !entry.parse_error && (
            <span className="ml-1 text-gray-400">· 미파싱</span>
          )}
        </span>
        <span className="flex items-center gap-2">
          <ReparseButton rawEntryId={entry.id} />
          <HideRestoreButton rawEntryId={entry.id} hidden={hidden} />
        </span>
      </header>

      {/* 원문 — 가장 크게. */}
      <p className="whitespace-pre-wrap px-3 pb-2 pt-1 text-base leading-relaxed">
        {entry.transcript}
      </p>

      {/* 파싱 결과 — 그 아래 작게. */}
      <div className="flex flex-col gap-2 border-t border-gray-100 px-3 py-2">
        {events.length > 0 && (
          <div className="flex flex-col gap-1">
            {events.map((e) => (
              <EventItem key={e.id} event={e} />
            ))}
          </div>
        )}

        {hypotheses.length > 0 && (
          <ul className="flex flex-col gap-1">
            {hypotheses.map((h) => (
              <li
                key={h.id}
                className="rounded border border-dashed border-gray-300 px-2 py-1 text-sm text-gray-600"
              >
                <span className="mr-1 text-[11px] text-gray-400">추측</span>“{h.statement}”
                {(h.cause_hint || h.effect_hint) && (
                  <span className="block text-[11px] text-gray-400">
                    {h.cause_hint ?? "?"} → {h.effect_hint ?? "?"}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}

        {unparsed.length > 0 && (
          <ul className="flex flex-wrap gap-1">
            {unparsed.map((u) => (
              <li key={u.id} className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                {u.text}
              </li>
            ))}
          </ul>
        )}

        {events.length === 0 && hypotheses.length === 0 && unparsed.length === 0 && (
          <p className="text-xs text-gray-400">파싱된 항목 없음</p>
        )}
      </div>
    </article>
  );
}
