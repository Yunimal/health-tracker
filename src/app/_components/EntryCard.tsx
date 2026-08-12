import type { TimelineData } from "@/lib/db/queries";
import { toKstWallClock } from "@/lib/format";
import EventItem from "./EventItem";
import ReparseButton from "./ReparseButton";
import HideRestoreButton from "./HideRestoreButton";

/** 원문 1건 + 거기서 나온 events / hypotheses / unparsed 를 대조해 보여준다. (기획서 §4.1) */
export default function EntryCard({ data }: { data: TimelineData }) {
  const { entry, events, hypotheses, unparsed } = data;
  const hidden = entry.hidden_at != null;

  return (
    <article className={`rounded-lg border border-gray-300 ${hidden ? "opacity-50" : ""}`}>
      <header className="flex items-center justify-between gap-2 border-b border-gray-200 px-3 py-1.5">
        <span className="text-xs text-gray-600">
          {toKstWallClock(entry.recorded_at)} · {entry.source}
          {hidden && <span className="ml-2 text-gray-500">· 숨김</span>}
          {entry.parse_error && <span className="ml-2 text-red-600">· 파싱 오류</span>}
          {!entry.parsed_at && !entry.parse_error && (
            <span className="ml-2 text-gray-400">· 미파싱</span>
          )}
        </span>
        <span className="flex items-center gap-2">
          <ReparseButton rawEntryId={entry.id} />
          <HideRestoreButton rawEntryId={entry.id} hidden={hidden} />
        </span>
      </header>

      <div className="grid gap-3 p-3 md:grid-cols-2">
        {/* 왼쪽: 원문 (수정 불가) */}
        <div>
          <div className="mb-1 text-[11px] font-medium text-gray-500">원문</div>
          <p className="whitespace-pre-wrap text-sm">{entry.transcript}</p>
          <p className="mt-1 text-[11px] text-gray-400">
            원문은 보존을 위해 수정할 수 없습니다 (DB 트리거로 UPDATE 차단).
            <br />
            잘못 기록됐다면 숨기고 다시 입력하세요.
          </p>
        </div>

        {/* 오른쪽: 파싱 결과 */}
        <div className="flex flex-col gap-2">
          <div className="text-[11px] font-medium text-gray-500">파싱 결과 (클릭해서 교정)</div>

          {events.length === 0 ? (
            <p className="text-xs text-gray-400">이벤트 없음</p>
          ) : (
            <div className="flex flex-col gap-1">
              {events.map((e) => (
                <EventItem key={e.id} event={e} />
              ))}
            </div>
          )}

          {hypotheses.length > 0 && (
            <div>
              <div className="mb-1 text-[11px] font-medium text-gray-500">가설</div>
              <ul className="flex flex-col gap-1">
                {hypotheses.map((h) => (
                  <li
                    key={h.id}
                    className="rounded border border-dashed border-gray-300 px-2 py-1 text-sm"
                  >
                    “{h.statement}”
                    {(h.cause_hint || h.effect_hint) && (
                      <span className="block text-[11px] text-gray-500">
                        {h.cause_hint ?? "?"} → {h.effect_hint ?? "?"}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {unparsed.length > 0 && (
            <div>
              <div className="mb-1 text-[11px] font-medium text-gray-500">미분류 (unparsed)</div>
              <ul className="flex flex-wrap gap-1">
                {unparsed.map((u) => (
                  <li key={u.id} className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                    {u.text}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
