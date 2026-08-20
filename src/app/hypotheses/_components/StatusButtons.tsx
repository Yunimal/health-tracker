"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setHypothesisStatus } from "../../actions";
import type { HypothesisStatus } from "@/lib/db/schema";

/** 상태 3종(맞음/아님/모름). "이건 아니야"(dismissed)는 별도 버튼으로 분리한다. */
const CHOICES: { status: HypothesisStatus; label: string }[] = [
  { status: "supported", label: "맞는 것 같아" },
  { status: "not_supported", label: "아니었어" },
  { status: "open", label: "아직 모르겠어" },
];

/**
 * 가설 상태 버튼. 현재 상태는 채워서(진하게) 표시한다. 판단하는 말은 쓰지 않는다 —
 * 라벨은 사용자의 대답 그대로("맞는 것 같아")이고, 앱이 결론을 붙이지 않는다.
 * 정한 가설을 "아직 모르겠어"로 눌러 다시 open 으로 되돌릴 수 있다.
 */
export default function StatusButtons({
  id,
  status,
}: {
  id: string;
  status: HypothesisStatus;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function choose(next: HypothesisStatus) {
    if (pending || next === status) return;
    setError(null);
    start(async () => {
      const res = await setHypothesisStatus(id, next);
      if (res.ok) router.refresh();
      else setError(res.error ?? "실패");
    });
  }

  const cls = (active: boolean) =>
    active
      ? "rounded bg-gray-900 px-2 py-0.5 text-xs text-white disabled:opacity-40"
      : "rounded border border-gray-300 px-2 py-0.5 text-xs hover:bg-gray-100 disabled:opacity-40";

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {CHOICES.map((c) => (
        <button
          key={c.status}
          onClick={() => choose(c.status)}
          disabled={pending}
          aria-pressed={status === c.status}
          className={cls(status === c.status)}
        >
          {c.label}
        </button>
      ))}
      <button
        onClick={() => choose("dismissed")}
        disabled={pending}
        aria-pressed={status === "dismissed"}
        className={
          status === "dismissed"
            ? "ml-1 rounded bg-gray-500 px-2 py-0.5 text-xs text-white disabled:opacity-40"
            : "ml-1 rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-500 hover:bg-gray-100 disabled:opacity-40"
        }
      >
        이건 아니야
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
