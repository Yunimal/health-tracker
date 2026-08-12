import "server-only";
import { cookies } from "next/headers";
import { getSupabaseClient } from "@/lib/db/client";

/**
 * 다중 사용자 인증(가족 3명). Supabase Auth 없이 app_users.ingest_token 으로 식별한다.
 *
 * ⚠️ 진짜 보안 경계가 아니다: 토큰을 아는 사람은 그 사용자의 기록을 볼 수 있다.
 *    가족 3명 + 전원 동의 전제에서만 쓴다. 외부 공개 배포에는 부적합. (CLAUDE.md 참고)
 *
 * - API 라우트(/api/entries, /api/parse): Authorization: Bearer <token>
 * - 웹(페이지/서버 액션): httpOnly 쿠키(AUTH_COOKIE)의 token
 */

export interface AuthUser {
  id: string;
  label: string;
}

/** 웹 로그인 토큰을 담는 httpOnly 쿠키 이름. */
export const AUTH_COOKIE = "ht_token";

// token → 사용자 조회 결과를 짧게 캐시한다(매 요청 DB 조회는 낭비). null(미매칭)도 캐시.
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { user: AuthUser | null; expiresAt: number }>();

/** ingest_token 으로 app_users 를 조회한다. 없으면 null. 결과는 60초 메모리 캐시. */
export async function resolveUserByToken(token: string): Promise<AuthUser | null> {
  if (!token) return null;
  const now = Date.now();
  const hit = cache.get(token);
  if (hit && hit.expiresAt > now) return hit.user;

  const supabase = getSupabaseClient();
  const { data } = await supabase
    .from("app_users")
    .select("id, label")
    .eq("ingest_token", token)
    .maybeSingle();
  const row = data as { id: string; label: string } | null;
  const user: AuthUser | null = row ? { id: row.id, label: row.label } : null;
  cache.set(token, { user, expiresAt: now + CACHE_TTL_MS });
  return user;
}

/** Authorization: Bearer <token> 헤더에서 토큰만 뽑는다. 없으면 null. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m?.[1] ?? null;
}

/** API 라우트용: Bearer 토큰으로 사용자 해석. 토큰이 없거나 매칭 안 되면 null(→ 호출부 401). */
export async function userFromRequest(request: Request): Promise<AuthUser | null> {
  const token = bearerToken(request);
  return token ? resolveUserByToken(token) : null;
}

/** 웹용: httpOnly 쿠키의 토큰으로 사용자 해석. 로그인 안 됐으면 null(→ 호출부 /login 리다이렉트). */
export async function currentWebUser(): Promise<AuthUser | null> {
  const store = await cookies();
  const token = store.get(AUTH_COOKIE)?.value;
  return token ? resolveUserByToken(token) : null;
}
