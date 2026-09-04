"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { mergeThings, rejectThingMerge, deleteThing, renameThing } from "../_actions";
import MergeConfirmDialog, { type MergeTarget } from "./MergeConfirmDialog";
import DeleteConfirmDialog, { type DeleteTarget } from "./DeleteConfirmDialog";
import type { Thing } from "@/lib/db/schema";
import type { CandidatePair } from "@/lib/parser/thing-extract";

const KIND_LABEL: Record<string, string> = {
  treatment: "시술",
  product: "제품",
  place: "장소",
  regimen: "루틴",
};

const KIND_COLOR: Record<string, string> = {
  treatment: "border-indigo-200 bg-indigo-50 text-indigo-700",
  product: "border-blue-200 bg-blue-50 text-blue-700",
  place: "border-green-200 bg-green-50 text-green-700",
  regimen: "border-orange-200 bg-orange-50 text-orange-700",
};

/** 이름이 긴 쪽이 winner. 같으면 더 많이 언급된 것. */
function determineMerge(a: Thing, b: Thing): MergeTarget {
  const aWins =
    a.name.length > b.name.length ||
    (a.name.length === b.name.length && a.mention_count >= b.mention_count);
  const [winner, loser] = aWins ? [a, b] : [b, a];
  return {
    winnerId: winner.id,
    winnerName: winner.name,
    winnerCount: winner.mention_count,
    loserId: loser.id,
    loserName: loser.name,
    loserCount: loser.mention_count,
  };
}

/** 인라인 이름 수정 입력창. 마운트 시 자동 포커스. */
function RenameInput({
  initialName,
  pending,
  onSubmit,
  onCancel,
}: {
  initialName: string;
  pending: boolean;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialName);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter") { e.preventDefault(); onSubmit(value); }
    if (e.key === "Escape") onCancel();
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      <input
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKey}
        disabled={pending}
        className="min-w-0 flex-1 rounded border border-gray-400 px-1.5 py-0.5 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-gray-500 disabled:opacity-50"
      />
      <button
        onClick={() => onSubmit(value)}
        disabled={pending || !value.trim()}
        className="shrink-0 rounded border border-gray-300 bg-white px-2 py-0.5 text-xs hover:bg-gray-50 disabled:opacity-50"
      >
        확인
      </button>
      <button
        onClick={onCancel}
        disabled={pending}
        className="shrink-0 text-xs text-gray-400 hover:text-gray-600 disabled:opacity-50"
      >
        취소
      </button>
    </div>
  );
}

export default function ThingsClient({
  things,
  candidates,
}: {
  things: Thing[];
  candidates: CandidatePair[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // 병합 다이얼로그
  const [dialog, setDialog] = useState<MergeTarget | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);

  // 삭제 다이얼로그
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // 인라인 이름 수정
  const [editingId, setEditingId] = useState<string | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < 2) {
        next.add(id);
      } else {
        // 이미 2개 선택 — 오래된 것을 빼고 새 것으로 교체
        const [first] = next;
        next.clear();
        next.add(first!);
        next.add(id);
      }
      return next;
    });
  }

  function openDialogFor(a: Thing, b: Thing) {
    setDialogError(null);
    setDialog(determineMerge(a, b));
  }

  function openDialogForSelection() {
    const [idA, idB] = [...selected];
    const a = things.find((t) => t.id === idA);
    const b = things.find((t) => t.id === idB);
    if (!a || !b) return;
    openDialogFor(a, b);
  }

  function confirmMerge() {
    if (!dialog) return;
    setDialogError(null);
    start(async () => {
      const res = await mergeThings(dialog.winnerId, dialog.loserId);
      if (res.ok) {
        setDialog(null);
        setSelected(new Set());
        router.refresh();
      } else {
        setDialogError(res.error ?? "실패");
      }
    });
  }

  function reject(aId: string, bId: string) {
    start(async () => {
      await rejectThingMerge(aId, bId);
      router.refresh();
    });
  }

  function openDeleteFor(t: Thing) {
    setDeleteError(null);
    setDeleteTarget({ id: t.id, name: t.name, kind: t.kind, mentionCount: t.mention_count });
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    setDeleteError(null);
    start(async () => {
      const res = await deleteThing(deleteTarget.id);
      if (res.ok) {
        setDeleteTarget(null);
        setSelected((prev) => { const n = new Set(prev); n.delete(deleteTarget.id); return n; });
        router.refresh();
      } else {
        setDeleteError(res.error ?? "실패");
      }
    });
  }

  function startEdit(t: Thing) {
    setRenameError(null);
    setEditingId(t.id);
  }

  function cancelEdit() {
    setEditingId(null);
    setRenameError(null);
  }

  function submitRename(id: string, newName: string) {
    setRenameError(null);
    start(async () => {
      const res = await renameThing(id, newName);
      if (res.ok) {
        setEditingId(null);
        router.refresh();
      } else {
        setRenameError(res.error ?? "실패");
      }
    });
  }

  const selectedArr = [...selected];
  const canMergeSelection = selectedArr.length === 2;

  return (
    <>
      {/* ── 합칠 만한 것들 ────────────────────────────────────────────────── */}
      {candidates.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-gray-700">합칠 만한 것들</h2>
          <ul className="flex flex-col gap-1.5">
            {candidates.map(({ a, b }) => (
              <li
                key={`${a.id}-${b.id}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2"
              >
                <span className="text-sm">
                  <span className="font-medium">{a.name}</span>
                  <span className="mx-1 text-gray-400">·</span>
                  <span className="font-medium">{b.name}</span>
                  <span className="ml-1.5 text-[11px] text-gray-500">
                    ({KIND_LABEL[a.kind] ?? a.kind})
                  </span>
                </span>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => openDialogFor(a, b)}
                    disabled={pending}
                    className="rounded border border-gray-300 bg-white px-2 py-0.5 text-xs hover:bg-gray-50 disabled:opacity-50"
                  >
                    같은 것
                  </button>
                  <button
                    onClick={() => reject(a.id, b.id)}
                    disabled={pending}
                    className="rounded border border-gray-300 bg-white px-2 py-0.5 text-xs text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                  >
                    다름
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── 전체 목록 ─────────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-gray-700">
            전체 {things.length}개
          </h2>
          {canMergeSelection && (
            <button
              onClick={openDialogForSelection}
              disabled={pending}
              className="rounded-lg bg-gray-900 px-3 py-1 text-xs text-white hover:bg-gray-700 disabled:opacity-50"
            >
              선택한 두 개 합치기
            </button>
          )}
        </div>

        {things.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">아직 추적 중인 대상이 없습니다.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {things.map((t) => {
              const isSelected = selected.has(t.id);
              const isEditing = editingId === t.id;
              return (
                <li
                  key={t.id}
                  className={`flex items-start gap-3 rounded-lg border px-3 py-2 transition-colors ${
                    isSelected ? "border-gray-400 bg-gray-50" : "border-gray-200"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelect(t.id)}
                    className="mt-0.5 h-4 w-4 cursor-pointer rounded border-gray-300 accent-gray-800"
                    aria-label={t.name}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-1.5">
                      {isEditing ? (
                        <RenameInput
                          initialName={t.name}
                          pending={pending}
                          onSubmit={(name) => submitRename(t.id, name)}
                          onCancel={cancelEdit}
                        />
                      ) : (
                        <>
                          <span className="font-medium">{t.name}</span>
                          <button
                            onClick={() => startEdit(t)}
                            disabled={pending}
                            title="이름 수정"
                            className="text-gray-300 hover:text-gray-500 disabled:opacity-40"
                            aria-label="이름 수정"
                          >
                            {/* pencil icon */}
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
                              <path d="M13.488 2.513a1.75 1.75 0 0 0-2.475 0L3.25 10.276a2.75 2.75 0 0 0-.714 1.284l-.5 2a.75.75 0 0 0 .905.905l2-.5a2.75 2.75 0 0 0 1.284-.714l7.763-7.763a1.75 1.75 0 0 0 0-2.475Z" />
                            </svg>
                          </button>
                        </>
                      )}
                      {!isEditing && (
                        <span
                          className={`inline-block rounded border px-1.5 py-0 text-[10px] ${KIND_COLOR[t.kind] ?? ""}`}
                        >
                          {KIND_LABEL[t.kind] ?? t.kind}
                        </span>
                      )}
                    </div>
                    {editingId === t.id && renameError && (
                      <p className="mt-0.5 text-[11px] text-red-600">{renameError}</p>
                    )}
                    {t.aliases.length > 0 && (
                      <p className="mt-0.5 text-[11px] text-gray-400">
                        = {t.aliases.join(", ")}
                      </p>
                    )}
                    {t.note && (
                      <p className="mt-0.5 text-[11px] text-gray-500">{t.note}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-[11px] text-gray-400">{t.mention_count}건</span>
                    <button
                      onClick={() => openDeleteFor(t)}
                      disabled={pending}
                      title="삭제"
                      className="text-gray-300 hover:text-red-500 disabled:opacity-40"
                      aria-label="삭제"
                    >
                      {/* trash icon */}
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                        <path fillRule="evenodd" d="M5 3.25V4H2.75a.75.75 0 0 0 0 1.5h.3l.815 8.15A1.5 1.5 0 0 0 5.357 15h5.285a1.5 1.5 0 0 0 1.493-1.35l.815-8.15h.3a.75.75 0 0 0 0-1.5H11v-.75A2.25 2.25 0 0 0 8.75 1h-1.5A2.25 2.25 0 0 0 5 3.25Zm2.25-.75a.75.75 0 0 0-.75.75V4h3v-.75a.75.75 0 0 0-.75-.75h-1.5ZM6.05 6a.75.75 0 0 1 .787.713l.275 5.5a.75.75 0 0 1-1.498.075l-.275-5.5A.75.75 0 0 1 6.05 6Zm3.9 0a.75.75 0 0 1 .712.787l-.275 5.5a.75.75 0 0 1-1.498-.075l.275-5.5a.75.75 0 0 1 .786-.712Z" clipRule="evenodd" />
                      </svg>
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {canMergeSelection && (
          <p className="text-[11px] text-gray-400">
            선택:{" "}
            {selectedArr.map((id) => things.find((t) => t.id === id)?.name).join(" · ")}
          </p>
        )}
      </section>

      {/* ── 병합 확인 다이얼로그 ──────────────────────────────────────────── */}
      {dialog && (
        <MergeConfirmDialog
          target={dialog}
          pending={pending}
          error={dialogError}
          onConfirm={confirmMerge}
          onCancel={() => { setDialog(null); setDialogError(null); }}
        />
      )}

      {/* ── 삭제 확인 다이얼로그 ──────────────────────────────────────────── */}
      {deleteTarget && (
        <DeleteConfirmDialog
          target={deleteTarget}
          pending={pending}
          error={deleteError}
          onConfirm={confirmDelete}
          onCancel={() => { setDeleteTarget(null); setDeleteError(null); }}
        />
      )}
    </>
  );
}
