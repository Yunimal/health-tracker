"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSupabaseClient } from "@/lib/db/client";
import { AUTH_COOKIE, currentWebUser, resolveUserByToken } from "@/lib/auth";
import { reparseEntry } from "@/lib/parser/persist";
import type { Category, RawEntry } from "@/lib/db/schema";

/**
 * 타임라인 웹의 서버 액션. 브라우저는 이 함수들만 호출한다.
 * 사용자는 httpOnly 쿠키의 토큰으로 판별한다(@/lib/auth). 클라이언트 번들엔 토큰이 안 들어간다.
 * ⚠️ 진짜 보안 경계가 아니다 — 가족 3명 + 전원 동의 전제. (CLAUDE.md 참고)
 */

export interface ActionResult {
  ok: boolean;
  error?: string;
}

function kstNowIso(): string {
  const kstMs = new Date().getTime() + 9 * 60 * 60 * 1000;
  return new Date(kstMs).toISOString().replace("Z", "+09:00");
}

// ── 로그인 / 로그아웃 ─────────────────────────────────────────────────────────
/** 토큰을 검증하고 httpOnly 쿠키에 저장한다. 유효하지 않으면 저장하지 않는다. */
export async function login(token: string): Promise<ActionResult> {
  const t = token.trim();
  if (!t) return { ok: false, error: "토큰을 입력하세요" };
  const user = await resolveUserByToken(t);
  if (!user) return { ok: false, error: "토큰이 올바르지 않습니다" };

  const store = await cookies();
  store.set(AUTH_COOKIE, t, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 400, // ~400일
  });
  return { ok: true };
}

export async function logout(): Promise<void> {
  const store = await cookies();
  store.delete(AUTH_COOKIE);
  redirect("/login");
}

/**
 * 텍스트 원문을 저장하고 즉시 반환한다. 파싱은 기다리지 않고 백그라운드로 돌린다
 * (POST /api/entries 와 동일하게 after() 로 미룬다). 가족이 쓰는 웹 입력이 파싱 몇 초에
 * 멈춰 있지 않게 하려는 것. 원문 카드는 바로 뜨고, "정리 중" 표시는 클라이언트가 몇 번
 * 폴링해 채운다(PendingPoller). 파싱이 실패해도 원문은 남고 parse_error 에 기록된다.
 */
export async function createTextEntry(text: string): Promise<ActionResult> {
  if (text.trim().length === 0) return { ok: false, error: "빈 입력" };
  const supabase = getSupabaseClient();
  const user = await currentWebUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  const userId = user.id;

  const { data, error } = await supabase
    .from("raw_entries")
    .insert({ user_id: userId, transcript: text, source: "text", recorded_at: kstNowIso() })
    .select()
    .single();
  if (error) return { ok: false, error: error.message };

  // 파싱은 응답 이후 백그라운드로. 실패해도 원문은 이미 저장됐다(parse_error 에 기록).
  const entry = data as RawEntry;
  try {
    after(async () => {
      try {
        await reparseEntry(getSupabaseClient(), userId, entry);
      } catch (err) {
        console.error(`[actions] 백그라운드 파싱 실패 (raw_entry ${entry.id}):`, err);
      }
    });
  } catch (err) {
    // after() 가 요청 스코프 밖에서 호출되면(예: 테스트) 스케줄만 건너뛴다.
    console.warn("[actions] after() 스케줄 생략:", err);
  }

  revalidatePath("/");
  return { ok: true };
}

/** 원문 1건을 다시 파싱한다(POST /api/parse 단건과 동일 경로). */
export async function reparseEntryById(rawEntryId: string): Promise<ActionResult> {
  const supabase = getSupabaseClient();
  const user = await currentWebUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  const userId = user.id;
  const { data, error } = await supabase
    .from("raw_entries")
    .select("*")
    .eq("id", rawEntryId)
    .eq("user_id", userId)
    .single();
  if (error || !data) return { ok: false, error: "원문을 찾지 못했습니다" };
  const outcome = await reparseEntry(supabase, userId, data as RawEntry);
  revalidatePath("/");
  return { ok: outcome.ok, error: outcome.error };
}

export interface EventEdit {
  id: string;
  category: Category;
  occurred_at: string;
  payload: Record<string, unknown>;
}

/** 이벤트를 교정한다. 저장 시 corrected_by_user = true. (transcript 는 건드리지 않는다) */
export async function updateEvent(edit: EventEdit): Promise<ActionResult> {
  const supabase = getSupabaseClient();
  const user = await currentWebUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  const userId = user.id;
  const { error } = await supabase
    .from("events")
    .update({
      category: edit.category,
      occurred_at: edit.occurred_at,
      payload: edit.payload,
      corrected_by_user: true,
    })
    .eq("id", edit.id)
    .eq("user_id", userId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/");
  return { ok: true };
}

/** 이벤트 삭제. (파생 데이터이므로 자유롭게 삭제 가능) */
export async function deleteEvent(eventId: string): Promise<ActionResult> {
  const supabase = getSupabaseClient();
  const user = await currentWebUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  const userId = user.id;
  const { error } = await supabase.from("events").delete().eq("id", eventId).eq("user_id", userId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/");
  return { ok: true };
}

/**
 * 원문 숨김(소프트 삭제) / 복원. hidden_at 만 갱신하므로 0002/0004 트리거가 허용한다.
 * 완전 삭제(DELETE)는 하지 않는다 — 원문은 보존된다. events 는 건드리지 않는다
 * (화면에서만 함께 숨겨지고, 재파싱하면 어차피 다시 생성된다).
 */
export async function hideEntry(rawEntryId: string): Promise<ActionResult> {
  const supabase = getSupabaseClient();
  const user = await currentWebUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  const userId = user.id;
  const { error } = await supabase
    .from("raw_entries")
    .update({ hidden_at: new Date().toISOString() })
    .eq("id", rawEntryId)
    .eq("user_id", userId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/");
  return { ok: true };
}

export async function unhideEntry(rawEntryId: string): Promise<ActionResult> {
  const supabase = getSupabaseClient();
  const user = await currentWebUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  const userId = user.id;
  const { error } = await supabase
    .from("raw_entries")
    .update({ hidden_at: null })
    .eq("id", rawEntryId)
    .eq("user_id", userId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/");
  return { ok: true };
}
