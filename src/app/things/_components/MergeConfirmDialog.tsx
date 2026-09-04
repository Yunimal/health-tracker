"use client";

/** 병합 직전 확인 다이얼로그. 어느 이름이 살아남고 몇 건이 옮겨지는지 보여준다. */
export interface MergeTarget {
  winnerId: string;
  winnerName: string;
  winnerCount: number;
  loserId: string;
  loserName: string;
  loserCount: number;
}

export default function MergeConfirmDialog({
  target,
  pending,
  error,
  onConfirm,
  onCancel,
}: {
  target: MergeTarget;
  pending: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-sm font-semibold">병합 확인</h2>

        <div className="mb-4 rounded-lg bg-gray-50 px-4 py-3 text-sm leading-relaxed">
          <span className="font-medium text-gray-500">{target.loserName}</span>
          <span className="text-gray-400"> ({target.loserCount}건) 의 언급을</span>
          <br />
          <span className="font-semibold">{target.winnerName}</span>
          <span className="text-gray-600"> 에 합칩니다.</span>
          <p className="mt-2 text-[11px] text-gray-400">
            "{target.loserName}" 은 "{target.winnerName}" 의 별칭으로 보존됩니다.
          </p>
        </div>

        <p className="mb-4 text-[11px] text-amber-700">
          합치면 되돌릴 수 없습니다.
        </p>

        {error && <p className="mb-3 text-xs text-red-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={pending}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            취소
          </button>
          <button
            onClick={onConfirm}
            disabled={pending}
            className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm text-white hover:bg-gray-700 disabled:opacity-50"
          >
            {pending ? "처리 중…" : "합치기"}
          </button>
        </div>
      </div>
    </div>
  );
}
