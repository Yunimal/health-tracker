import { redirect } from "next/navigation";
import { currentWebUser } from "@/lib/auth";
import LoginForm from "./LoginForm";

// 쿠키에 의존하므로 프리렌더하지 않는다.
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  // 이미 로그인돼 있으면 대시보드로.
  const user = await currentWebUser();
  if (user) redirect("/");

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <div>
        <h1 className="text-lg font-semibold">Health Tracker</h1>
        <p className="mt-1 text-sm text-gray-500">발급받은 토큰을 붙여넣어 로그인하세요.</p>
      </div>
      <LoginForm />
      <p className="text-xs text-gray-400">
        ⚠️ 토큰을 아는 사람은 그 사용자의 기록을 볼 수 있습니다. 가족끼리만 공유하세요.
      </p>
    </main>
  );
}
