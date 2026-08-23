"use client";

import { useMemo, useState } from "react";
import type { Category } from "@/lib/db/schema";
import type { DashboardEvent } from "@/lib/db/queries";
import { CATEGORY_ICON, CATEGORY_LABEL, formatWhen, relativeDay, summarizeEvent } from "@/lib/format";

/** occurred_at(ISO) → KST YYYY-MM-DD. (queries 의 집계 기준과 동일) */
const kstDateOf = (iso: string): string =>
  new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

/** 건수 → 농도. 0 은 호출부에서 따로 처리(기록 없는 날 vs 항목 없음 구분). */
function fillClass(count: number): string {
  if (count >= 4) return "bg-gray-900";
  if (count === 3) return "bg-gray-700";
  if (count === 2) return "bg-gray-500";
  return "bg-gray-300"; // 1건
}

const CELL = 18; // px

/**
 * 일별 히트맵. 세로 카테고리 12개 × 가로 날짜. 칸을 누르면 그날 그 카테고리 이벤트가 아래 펼쳐진다.
 * 기록이 아예 없는 날은 열을 흐리게(기록 안 한 날 ≠ 기록했지만 그 항목이 없던 날). 사용자 지시 [1].
 */
export default function Heatmap({
  dates,
  rows,
  events,
}: {
  dates: string[];
  rows: Category[];
  events: DashboardEvent[];
}) {
  const [sel, setSel] = useState<{ date: string; category: Category } | null>(null);

  // 집계: `${category}|${date}` → 건수, 그리고 날짜별 총건수(그날 기록이 하나라도 있는지).
  const { counts, dayHasAny } = useMemo(() => {
    const counts = new Map<string, number>();
    const dayHasAny = new Set<string>();
    for (const e of events) {
      const d = kstDateOf(e.occurred_at);
      counts.set(`${e.category}|${d}`, (counts.get(`${e.category}|${d}`) ?? 0) + 1);
      dayHasAny.add(d);
    }
    return { counts, dayHasAny };
  }, [events]);

  const selEvents = useMemo(() => {
    if (!sel) return [];
    return events
      .filter((e) => e.category === sel.category && kstDateOf(e.occurred_at) === sel.date)
      .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  }, [events, sel]);

  const gridCols = `72px repeat(${dates.length}, ${CELL}px)`;

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto pb-1">
        <div className="inline-grid gap-0.5" style={{ gridTemplateColumns: gridCols }}>
          {/* 헤더: 코너 + 날짜(일). 기록 없는 날은 흐리게. */}
          <div className="sticky left-0 z-10 bg-white" />
          {dates.map((d) => (
            <div
              key={d}
              className={`text-center text-[9px] leading-4 ${
                dayHasAny.has(d) ? "text-gray-500" : "text-gray-300"
              }`}
              title={d}
            >
              {Number(d.slice(8, 10))}
            </div>
          ))}

          {/* 카테고리별 행 */}
          {rows.map((cat) => (
            <FragmentRow
              key={cat}
              cat={cat}
              dates={dates}
              counts={counts}
              dayHasAny={dayHasAny}
              sel={sel}
              onPick={(date) =>
                setSel((cur) =>
                  cur && cur.date === date && cur.category === cat ? null : { date, category: cat },
                )
              }
            />
          ))}
        </div>
      </div>

      {/* 범례 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-gray-500">
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-[3px] bg-gray-300" /> 1건
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-[3px] bg-gray-500" /> 2건
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-[3px] bg-gray-700" /> 3건
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-[3px] bg-gray-900" /> 4건+
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-[3px] border border-gray-200 bg-white" /> 기록했지만 이 항목 없음
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-[3px] bg-gray-100" /> 기록 없는 날
        </span>
      </div>

      {/* 선택한 칸의 이벤트 목록 */}
      {sel && (
        <div className="rounded-lg border border-gray-300 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium">
              {CATEGORY_ICON[sel.category]} {CATEGORY_LABEL[sel.category]} · {relativeDay(`${sel.date}T12:00:00+09:00`)}
            </span>
            <button
              onClick={() => setSel(null)}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              닫기
            </button>
          </div>
          {selEvents.length === 0 ? (
            <p className="text-xs text-gray-400">이 날 이 항목의 기록이 없습니다.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {selEvents.map((e) => (
                <li key={e.id} className="text-sm">
                  <span className="text-[11px] text-gray-400">
                    {formatWhen(e.occurred_at, e.occurred_at_precision)}
                  </span>{" "}
                  {summarizeEvent(e.category, e.payload)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** 한 카테고리 행: 라벨 셀 + 날짜별 칸들. */
function FragmentRow({
  cat,
  dates,
  counts,
  dayHasAny,
  sel,
  onPick,
}: {
  cat: Category;
  dates: string[];
  counts: Map<string, number>;
  dayHasAny: Set<string>;
  sel: { date: string; category: Category } | null;
  onPick: (date: string) => void;
}) {
  return (
    <>
      <div
        className="sticky left-0 z-10 flex items-center gap-1 truncate bg-white pr-1 text-[11px] text-gray-600"
        style={{ height: CELL }}
      >
        <span aria-hidden>{CATEGORY_ICON[cat]}</span>
        <span className="truncate">{CATEGORY_LABEL[cat]}</span>
      </div>
      {dates.map((d) => {
        const count = counts.get(`${cat}|${d}`) ?? 0;
        const isSel = sel?.date === d && sel?.category === cat;
        let cls: string;
        if (count > 0) cls = fillClass(count);
        else if (dayHasAny.has(d)) cls = "bg-white border border-gray-200"; // 기록했지만 이 항목 없음
        else cls = "bg-gray-100"; // 기록 없는 날
        return (
          <button
            key={d}
            onClick={() => onPick(d)}
            title={`${CATEGORY_LABEL[cat]} · ${d} · ${count}건`}
            aria-label={`${CATEGORY_LABEL[cat]} ${d} ${count}건`}
            className={`rounded-[3px] ${cls} ${isSel ? "ring-2 ring-blue-500" : ""}`}
            style={{ height: CELL }}
          />
        );
      })}
    </>
  );
}
