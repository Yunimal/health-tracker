"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { login } from "../actions";

/** 토큰 입력 → 검증되면 httpOnly 쿠키에 저장(서버 액션)하고 대시보드로 이동. */
export default function LoginForm() {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function submit() {
    if (token.trim().length === 0 || pending) return;
    setError(null);
    start(async () => {
      const res = await login(token);
      if (res.ok) {
        router.replace("/");
        router.refresh();
      } else {
        setError(res.error ?? "로그인 실패");
      }
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex flex-col gap-2"
    >
      <input
        type="password"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="토큰 붙여넣기"
        autoComplete="off"
        className="rounded border border-gray-300 p-2 text-sm outline-none focus:border-gray-900"
      />
      <button
        type="submit"
        disabled={pending || token.trim().length === 0}
        className="h-10 rounded bg-gray-900 px-4 text-sm font-medium text-white disabled:opacity-40"
      >
        {pending ? "확인 중…" : "로그인"}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </form>
  );
}
