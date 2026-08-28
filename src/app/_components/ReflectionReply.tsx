"use client";

import { useState, useTransition } from "react";
import { replyToReflection } from "../actions";

/**
 * 성찰 한 줄 + "같이 생각해보기". 버튼을 눌러야만 LLM 응답을 만든다(자동 생성 X). 이미 받은
 * 응답이 있으면 그대로 보여준다. 응답은 결론이 아니라 되물어주는 말이다. (기능 A)
 */
export default function ReflectionReply({
  rawEntryId,
  text,
  existingReply,
}: {
  rawEntryId: string;
  text: string;
  existingReply: string | null;
}) {
  const [reply, setReply] = useState<string | null>(existingReply);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function ask() {
    if (pending) return;
    setError(null);
    start(async () => {
      const res = await replyToReflection(rawEntryId, text);
      if (res.ok && res.reply) setReply(res.reply);
      else setError(res.error ?? "실패");
    });
  }

  return (
    <li className="rounded border border-dashed border-gray-300 px-2 py-1.5">
      <p className="whitespace-pre-wrap text-sm text-gray-700">{text}</p>

      {reply ? (
        <p className="mt-1.5 whitespace-pre-wrap rounded bg-gray-50 px-2 py-1.5 text-[13px] leading-relaxed text-gray-600">
          {reply}
        </p>
      ) : (
        <div className="mt-1 flex items-center gap-2">
          <button
            onClick={ask}
            disabled={pending}
            className="rounded border border-gray-300 px-2 py-0.5 text-[11px] text-gray-600 hover:bg-gray-50 disabled:opacity-40"
          >
            {pending ? "생각하는 중…" : "같이 생각해보기"}
          </button>
          {error && <span className="text-[11px] text-red-600">{error}</span>}
        </div>
      )}
    </li>
  );
}
