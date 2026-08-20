"use client";

import { useState } from "react";
import type { Hypothesis } from "@/lib/db/schema";
import HypothesisItem from "./HypothesisItem";

/**
 * 상태를 정한(open 이 아닌) 가설을 접어서 보관. 펼치면 상태 버튼으로 되돌릴 수 있다.
 * (되돌리기는 HypothesisItem 안의 "아직 모르겠어" = open 으로 처리)
 */
export default function ResolvedList({ items }: { items: Hypothesis[] }) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;

  return (
    <section className="flex flex-col gap-2">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="self-start text-sm text-gray-500 hover:text-gray-700"
      >
        {open ? "▾" : "▸"} 정한 가설 {items.length}개
      </button>

      {open && (
        <ul className="flex flex-col gap-2 opacity-80">
          {items.map((h) => (
            <HypothesisItem key={h.id} h={h} />
          ))}
        </ul>
      )}
    </section>
  );
}
