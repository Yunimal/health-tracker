"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { reparseEntryById } from "../actions";

/** 원문 1건 다시 파싱. 파싱은 events/hypotheses/unparsed 를 삭제 후 재생성한다(교정 내용도 초기화). */
export default function ReparseButton({
  rawEntryId,
  label = "다시 파싱",
  className = "rounded border border-gray-300 px-2 py-0.5 text-xs hover:bg-gray-100 disabled:opacity-40",
}: {
  rawEntryId: string;
  label?: string;
  className?: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function run() {
    if (pending) return;
    setError(null);
    start(async () => {
      const res = await reparseEntryById(rawEntryId);
      if (res.ok) router.refresh();
      else setError(res.error ?? "실패");
    });
  }

  return (
    <span className="flex items-center gap-1">
      <button
        onClick={run}
        disabled={pending}
        title="이 원문을 다시 파싱 (기존 events/hypotheses/unparsed 를 지우고 재생성)"
        className={className}
      >
        {pending ? "파싱 중…" : label}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
