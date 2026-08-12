"use client";

import { useRouter } from "next/navigation";

/** YYYY-MM-DD 를 days 만큼 이동(UTC 기준 순수 산술이라 tz 영향 없음). */
function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 날짜 선택 + 좌우 이동. 선택 시 /?date= 로 이동한다. */
export default function DateNav({ date }: { date: string }) {
  const router = useRouter();
  const go = (d: string) => router.push(`/?date=${d}`);

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => go(shiftDate(date, -1))}
        aria-label="이전 날짜"
        className="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-100"
      >
        ←
      </button>
      <input
        type="date"
        value={date}
        onChange={(e) => e.target.value && go(e.target.value)}
        className="rounded border border-gray-300 px-2 py-1 text-sm"
      />
      <button
        onClick={() => go(shiftDate(date, 1))}
        aria-label="다음 날짜"
        className="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-100"
      >
        →
      </button>
    </div>
  );
}
