"use client";

import { useState, useTransition } from "react";
import { createHypothesisFromFactor } from "../../actions";

/**
 * 비교표 한 행의 원인 후보를 가설로 저장한다. 저장하면 hypotheses 에 open 으로 등록되고
 * "가설" 화면에서 검증할 수 있다. (difference 는 정렬용일 뿐 — 저장 여부는 사용자가 정한다)
 */
export default function SaveHypothesisButton({
  cause,
  effectLabel,
}: {
  cause: string;
  effectLabel: string;
}) {
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function run() {
    if (pending || saved) return;
    setError(null);
    start(async () => {
      const res = await createHypothesisFromFactor(cause, effectLabel);
      if (res.ok) setSaved(true);
      else setError(res.error ?? "실패");
    });
  }

  if (saved) return <span className="shrink-0 text-[11px] text-gray-400">저장됨 ✓</span>;

  return (
    <button
      onClick={run}
      disabled={pending}
      className="shrink-0 rounded border border-gray-300 px-2 py-0.5 text-[11px] text-gray-600 hover:bg-gray-50 disabled:opacity-40"
      title={`"${cause} 가 ${effectLabel} 에 영향을 주나?" 가설로 저장`}
    >
      {pending ? "저장 중…" : error ? "다시" : "가설로 저장"}
    </button>
  );
}
