"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { updateThingNote } from "../../_actions";

export default function NoteEditor({
  thingId,
  initialNote,
}: {
  thingId: string;
  initialNote: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialNote ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);

  function save() {
    setError(null);
    start(async () => {
      const res = await updateThingNote(thingId, value);
      if (res.ok) {
        setEditing(false);
      } else {
        setError(res.error ?? "저장 실패");
      }
    });
  }

  function cancel() {
    setValue(initialNote ?? "");
    setEditing(false);
    setError(null);
  }

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="w-full rounded-lg border border-dashed border-gray-300 px-3 py-2 text-left text-sm text-gray-500 hover:border-gray-400 hover:text-gray-700"
      >
        {value || "메모 추가…"}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={pending}
        rows={3}
        placeholder="메모를 입력하세요"
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400 disabled:opacity-50"
      />
      {error && <p className="text-[11px] text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={save}
          disabled={pending}
          className="rounded-lg bg-gray-900 px-3 py-1 text-xs text-white hover:bg-gray-700 disabled:opacity-50"
        >
          저장
        </button>
        <button
          onClick={cancel}
          disabled={pending}
          className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-50"
        >
          취소
        </button>
      </div>
    </div>
  );
}
