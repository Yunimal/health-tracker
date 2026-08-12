"use client";

import { useTransition } from "react";
import { logout } from "../actions";

/** 우측 상단: 현재 사용자 label + 로그아웃. 누구 화면인지 헷갈리지 않게 항상 보인다. */
export default function UserBar({ label }: { label: string }) {
  const [pending, start] = useTransition();

  return (
    <div className="flex items-center gap-2 text-xs text-gray-600">
      <span className="rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-800">
        {label}
      </span>
      <button
        onClick={() => start(() => logout())}
        disabled={pending}
        className="rounded border border-gray-300 px-2 py-0.5 hover:bg-gray-50 disabled:opacity-40"
      >
        로그아웃
      </button>
    </div>
  );
}
