import type { TimelineData } from "@/lib/db/queries";
import { formatDayTime, sourceLabel } from "@/lib/format";
import EventItem from "./EventItem";
import ReparseButton from "./ReparseButton";
import HideRestoreButton from "./HideRestoreButton";
import ReflectionReply from "./ReflectionReply";

/** 원문 1건 + 거기서 나온 events / hypotheses / unparsed / reflections. 원문을 크게, 파싱 결과는 그 아래 작게. */
export default function EntryCard({ data }: { data: TimelineData }) {
  const { entry, events, hypotheses, unparsed, reflections, replies } = data;
  /** 재파싱 후에도 응답이 유지되도록 (raw_entry_id, reflection_text)로 매칭한다. (0012) */
  const replyFor = (text: string) => replies.find((r) => r.reflection_text === text)?.reply ?? null;
  const hidden = entry.hidden_at != null;
  // 파싱 실패 시 reparseEntry 가 parsed_at 과 parse_error 를 함께 채운다. 따라서
  // 정리 중 = 둘 다 비어 있음, 정리 실패 = parse_error 있음, 완료 = 그 외.
  const failed = entry.parse_error != null;
  const pending = entry.parsed_at == null && entry.parse_error == null;

  return (
    <article className={`rounded-lg border border-gray-300 ${hidden ? "opacity-50" : ""}`}>
      <header className="flex items-center justify-between gap-2 px-3 pt-2">
        <span className="text-[11px] text-gray-400">
          {formatDayTime(entry.recorded_at)} · {sourceLabel(entry.source)}
          {hidden && <span className="ml-1 text-gray-400">· 숨김</span>}
          {failed && <span className="ml-1 text-amber-700">· 정리 실패</span>}
          {pending && <span className="ml-1 text-gray-400">· 정리 중…</span>}
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

      {/* 파싱 결과 — 그 아래 작게. 정리 중 / 정리 실패 / 완료 는 서로 배타적이다. */}
      <div className="flex flex-col gap-2 border-t border-gray-100 px-3 py-2">
        {pending ? (
          <p className="animate-pulse text-xs text-gray-400">정리 중…</p>
        ) : failed ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-amber-700">정리하지 못했어요.</span>
            <ReparseButton
              rawEntryId={entry.id}
              label="정리 실패 — 다시 파싱"
              className="rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-800 hover:bg-amber-100 disabled:opacity-40"
            />
          </div>
        ) : (
          <>
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

            {/* 생각 — 사건과 구분되게 별도 영역. "같이 생각해보기"는 눌러야만 응답 생성. */}
            {reflections.length > 0 && (
              <div className="flex flex-col gap-1">
                <span className="text-[11px] text-gray-400">생각</span>
                <ul className="flex flex-col gap-1">
                  {reflections.map((r) => (
                    <ReflectionReply
                      key={r.id}
                      rawEntryId={entry.id}
                      text={r.text}
                      existingReply={replyFor(r.text)}
                    />
                  ))}
                </ul>
              </div>
            )}

            {events.length === 0 &&
              hypotheses.length === 0 &&
              unparsed.length === 0 &&
              reflections.length === 0 && <p className="text-xs text-gray-400">파싱된 항목 없음</p>}
          </>
        )}
      </div>
    </article>
  );
}
