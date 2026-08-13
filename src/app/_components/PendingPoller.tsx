"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const INTERVAL_MS = 5000;
const MAX_POLLS = 3;

/**
 * "정리 중"(파싱 대기) 원문이 있을 때만 페이지가 이 컴포넌트를 렌더한다.
 * 5초 간격으로 최대 3번 router.refresh() 해서 백그라운드 파싱 결과가 나오면 채운다.
 * 그 뒤에는 멈춘다 — 무한 폴링은 하지 않는다(그 뒤엔 사용자가 새로고침).
 *
 * 페이지에서 대기 중 원문 id 집합을 key 로 넘긴다. 새 원문을 보내 집합이 바뀌면
 * remount 되어 폴링 카운터가 초기화되고 다시 최대 3번 돈다. 모두 파싱되면 페이지가
 * 이 컴포넌트를 더 이상 렌더하지 않아 언마운트되고 인터벌이 정리된다.
 */
export default function PendingPoller() {
  const router = useRouter();
  useEffect(() => {
    let polls = 0;
    const id = setInterval(() => {
      polls += 1;
      router.refresh();
      if (polls >= MAX_POLLS) clearInterval(id);
    }, INTERVAL_MS);
    return () => clearInterval(id);
  }, [router]);
  return null;
}
