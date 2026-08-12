"use client";

import { useRouter } from "next/navigation";

/** "숨긴 항목 보기" 토글. showHidden 을 URL 쿼리로 켜고 끈다(날짜는 유지). */
export default function ShowHiddenToggle({
  date,
  showHidden,
}: {
  date: string;
  showHidden: boolean;
}) {
  const router = useRouter();

  function toggle() {
    const params = new URLSearchParams({ date });
    if (!showHidden) params.set("showHidden", "1");
    router.push(`/?${params.toString()}`);
  }

  return (
    <label className="flex cursor-pointer items-center gap-1 text-xs text-gray-600">
      <input type="checkbox" checked={showHidden} onChange={toggle} />
      숨긴 항목 보기
    </label>
  );
}
