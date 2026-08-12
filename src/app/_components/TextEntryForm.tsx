"use client";

import { useState, useTransition, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { createTextEntry } from "../actions";

/** 텍스트 원문 입력창. Enter 전송, Shift+Enter 줄바꿈. 전송 후 비우고 목록 갱신. */
export default function TextEntryForm() {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function submit() {
    const value = text;
    if (value.trim().length === 0 || pending) return;
    setError(null);
    start(async () => {
      const res = await createTextEntry(value);
      if (res.ok) {
        setText("");
        router.refresh();
      } else {
        setError(res.error ?? "전송 실패");
      }
    });
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-end gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          placeholder="지금 상태를 적어 보세요. (Enter 전송 · Shift+Enter 줄바꿈)"
          className="min-h-[3rem] flex-1 resize-y rounded border border-gray-300 p-2 text-sm outline-none focus:border-gray-900"
        />
        <button
          onClick={submit}
          disabled={pending || text.trim().length === 0}
          className="h-10 shrink-0 rounded bg-gray-900 px-4 text-sm font-medium text-white disabled:opacity-40"
        >
          {pending ? "전송 중…" : "전송"}
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
