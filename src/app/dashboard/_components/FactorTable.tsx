"use client";

import { useState } from "react";
import Link from "next/link";
import SaveHypothesisButton from "./SaveHypothesisButton";

/**
 * 원인 후보 비교표 + 인라인 상세. 각 행을 누르면 그 항목이 있었던 날(좋음/나쁨)과 그날의 원문·
 * 결과값이 아래로 펼쳐진다. **LLM 요약 없이 원문 그대로.** 색은 좋음(청록)/나쁨(붉음, craving 은
 * 옅은 호박)으로 구분하되 기호(○/△)도 함께 써 색약에 대응한다. (사용자 지시)
 */

export interface OccurrenceEvent {
  time: string;
  summary: string;
  transcript: string;
  recordedDate: string; // /?date= 로 이동할 KST 날짜
}
export interface Occurrence {
  date: string;
  group: "good" | "bad";
  outcomeSummary: string; // 그날의 결과값 (예: "수면 질 나쁨 · 밤잠 설침")
  events: OccurrenceEvent[];
}
export interface FactorRow {
  id: string;
  label: string;
  goodCount: number;
  badCount: number;
  appearCount: number; // 등장한 서로 다른 날 수(전체 기간)
  firstDay: string | null;
  lastDay: string | null;
  outcomeValues: number[]; // scale 결과값 목록
  occurrences: Occurrence[];
}

const shortDay = (ymd: string) => {
  const [, m, d] = ymd.split("-");
  return `${Number(m)}/${Number(d)}`;
};

export default function FactorTable({
  rows,
  goodTotal,
  badTotal,
  goodLabel,
  badLabel,
  badMuted,
  effectLabel,
  showValues,
}: {
  rows: FactorRow[];
  goodTotal: number;
  badTotal: number;
  goodLabel: string;
  badLabel: string;
  badMuted: boolean;
  effectLabel: string;
  showValues: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  const good = { text: "text-teal-700", bg: "bg-teal-50", sym: "○" };
  const bad = badMuted
    ? { text: "text-amber-700", bg: "bg-amber-50", sym: "△" }
    : { text: "text-rose-700", bg: "bg-rose-50", sym: "△" };

  return (
    <div className="flex flex-col gap-2">
      {/* 범례 — 관찰 사실 라벨 + 기호 + 색. 표본 수(N일) 항상 노출 */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
        <span className={good.text}>
          {good.sym} {goodLabel} ({goodTotal}일)
        </span>
        <span className={bad.text}>
          {bad.sym} {badLabel} ({badTotal}일)
        </span>
      </div>

      {/* 헤더 */}
      <div className="flex items-center gap-2 border-b border-gray-200 pb-1 text-[11px] text-gray-500">
        <span className="flex-1">항목</span>
        <span className={`w-12 text-center ${good.text}`}>{good.sym}</span>
        <span className={`w-12 text-center ${bad.text}`}>{bad.sym}</span>
        <span className="w-16" />
      </div>

      <ul className="flex flex-col">
        {rows.map((f) => {
          const gRate = goodTotal ? f.goodCount / goodTotal : 0;
          const bRate = badTotal ? f.badCount / badTotal : 0;
          const open = openId === f.id;
          const goodOcc = f.occurrences.filter((o) => o.group === "good");
          const badOcc = f.occurrences.filter((o) => o.group === "bad");
          return (
            <li key={f.id} className="border-b border-gray-100">
              <div className="flex items-center gap-2 py-1.5">
                <button
                  onClick={() => setOpenId(open ? null : f.id)}
                  aria-expanded={open}
                  className="flex min-w-0 flex-1 items-center gap-1 text-left"
                >
                  <span className="shrink-0 text-[10px] text-gray-400">{open ? "▾" : "▸"}</span>
                  <span className="min-w-0 truncate text-sm">{f.label}</span>
                </button>
                <span
                  className={`w-12 rounded text-center text-sm tabular-nums ${good.text} ${gRate > bRate ? good.bg : ""}`}
                >
                  {f.goodCount}일
                </span>
                <span
                  className={`w-12 rounded text-center text-sm tabular-nums ${bad.text} ${bRate > gRate ? bad.bg : ""}`}
                >
                  {f.badCount}일
                </span>
                <span className="flex w-16 justify-end">
                  <SaveHypothesisButton cause={f.label} effectLabel={effectLabel} />
                </span>
              </div>

              {open && (
                <div className="flex flex-col gap-2 border-t border-gray-100 bg-gray-50 px-2 py-2 text-sm">
                  {/* 간단한 집계 (LLM 없이) */}
                  <p className="text-[11px] text-gray-500">
                    등장 {f.appearCount}일
                    {f.firstDay && ` · 처음 ${shortDay(f.firstDay)}`}
                    {f.lastDay && ` · 마지막 ${shortDay(f.lastDay)}`}
                  </p>
                  {showValues && f.outcomeValues.length > 0 && (
                    <p className="text-[11px] text-gray-500">
                      이 항목이 있던 날의 결과값: {f.outcomeValues.join(", ")}
                    </p>
                  )}

                  <OccurrenceGroup title={`${good.sym} ${goodLabel}`} cls={good.text} items={goodOcc} />
                  <OccurrenceGroup title={`${bad.sym} ${badLabel}`} cls={bad.text} items={badOcc} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-[11px] text-gray-400">
        숫자가 큰 차이여도 표본이 적으면 우연일 수 있어요. 나란히 보고 직접 판단하세요.
      </p>
    </div>
  );
}

function OccurrenceGroup({ title, cls, items }: { title: string; cls: string; items: Occurrence[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <span className={`text-[11px] font-medium ${cls}`}>
        {title} · {items.length}일
      </span>
      {items.map((o) => (
        <div key={o.date} className="rounded border border-gray-200 bg-white px-2 py-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[11px] text-gray-500">{shortDay(o.date)}</span>
            <span className="truncate text-[11px] text-gray-500">{o.outcomeSummary}</span>
          </div>
          {o.events.map((e, i) => (
            <div key={i} className="mt-1">
              <p className="text-[13px]">
                <span className="text-[11px] text-gray-400">{e.time}</span> {e.summary}
              </p>
              {e.transcript && (
                <Link
                  href={`/?date=${e.recordedDate}`}
                  className="mt-0.5 block whitespace-pre-wrap rounded bg-gray-50 px-2 py-1 text-[12px] leading-relaxed text-gray-600 hover:bg-gray-100"
                  title="이 날 타임라인으로 이동"
                >
                  “{e.transcript}”
                </Link>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
