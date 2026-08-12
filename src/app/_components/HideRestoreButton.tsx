"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { hideEntry, unhideEntry } from "../actions";

/** 원문 숨기기/복원. 숨길 때 confirm 으로 확인한다. 완전 삭제가 아니다. */
export default function HideRestoreButton({
  rawEntryId,
  hidden,
}: {
  rawEntryId: string;
  hidden: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function run() {
    if (pending) return;
    if (!hidden && !confirm("이 원문을 숨길까요? (완전 삭제가 아니라 목록에서만 감춰집니다)")) {
      return;
    }
    setError(null);
    start(async () => {
      const res = hidden ? await unhideEntry(rawEntryId) : await hideEntry(rawEntryId);
      if (res.ok) router.refresh();
      else setError(res.error ?? "실패");
    });
  }

  return (
    <span className="flex items-center gap-1">
      <button
        onClick={run}
        disabled={pending}
        className="rounded border border-gray-300 px-2 py-0.5 text-xs hover:bg-gray-100 disabled:opacity-40"
      >
        {hidden ? (pending ? "복원 중…" : "복원") : pending ? "숨기는 중…" : "숨기기"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
