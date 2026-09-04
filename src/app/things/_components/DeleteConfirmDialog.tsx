"use client";

const KIND_LABEL: Record<string, string> = {
  treatment: "시술",
  product: "제품",
  place: "장소",
  regimen: "루틴",
};

export interface DeleteTarget {
  id: string;
  name: string;
  kind: string;
  mentionCount: number;
}

export default function DeleteConfirmDialog({
  target,
  pending,
  error,
  onConfirm,
  onCancel,
}: {
  target: DeleteTarget;
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
        <h2 className="mb-3 text-sm font-semibold">삭제 확인</h2>

        <div className="mb-4 rounded-lg bg-gray-50 px-4 py-3 text-sm leading-relaxed">
          <span className="font-semibold">{target.name}</span>
          <span className="ml-1.5 text-[11px] text-gray-500">
            ({KIND_LABEL[target.kind] ?? target.kind})
          </span>
          {target.mentionCount > 0 && (
            <>
              <br />
              <span className="text-gray-500">
                {target.mentionCount}건의 언급이 함께 삭제됩니다.
              </span>
            </>
          )}
        </div>

        <p className="mb-4 text-[11px] text-amber-700">
          재파싱해도 다시 추출되지 않습니다.
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
            className="rounded-lg bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700 disabled:opacity-50"
          >
            {pending ? "삭제 중…" : "삭제"}
          </button>
        </div>
      </div>
    </div>
  );
}
