"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSupabaseClient } from "@/lib/db/client";
import { AUTH_COOKIE, currentWebUser, resolveUserByToken } from "@/lib/auth";
import { reparseEntry } from "@/lib/parser/persist";
import { generateReflectionReply } from "@/lib/reflect/reply";
import type { Category, HypothesisStatus, RawEntry } from "@/lib/db/schema";
import type { SupabaseClient } from "@supabase/supabase-js";

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

/**
 * 가설 상태 변경. open/supported/not_supported/dismissed 사이를 오간다.
 * status 는 사용자의 판단을 담는 필드일 뿐, 파싱 파생 데이터가 아니라서 자유롭게 갱신한다.
 * (statement/cause_hint 등 파싱 결과는 건드리지 않는다 — 재파싱해도 유지되도록.)
 * "정한" 가설을 다시 open 으로 되돌리는 것도 이 액션 하나로 처리한다.
 */
export async function setHypothesisStatus(
  id: string,
  status: HypothesisStatus,
): Promise<ActionResult> {
  const supabase = getSupabaseClient();
  const user = await currentWebUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  const { error } = await supabase
    .from("hypotheses")
    .update({ status })
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/hypotheses");
  revalidatePath("/"); // 메인의 "가설 N개" 카운트도 갱신
  return { ok: true };
}

/**
 * 대시보드 비교표의 원인 후보를 가설로 저장한다. (분석 → 검증 루프)
 * cause_hint = 항목명, effect_hint = 결과 라벨, statement = "X 가 Y 에 영향을 주나?" 형태.
 * 같은(cause,effect) open 가설이 이미 있으면 중복 생성하지 않는다(멱등).
 * 음성 발화에서 나온 가설이 아니므로 raw_entry_id 없이 만든다(mention 없음). 재파싱이 이 행을
 * 지우지 않는다 — persistHypotheses 는 원문에 링크된 가설만 건드린다. (persist.ts 참고)
 */
export async function createHypothesisFromFactor(
  cause: string,
  effectLabel: string,
): Promise<ActionResult> {
  const supabase = getSupabaseClient();
  const user = await currentWebUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  const c = cause.trim();
  const e = effectLabel.trim();
  if (!c || !e) return { ok: false, error: "빈 값" };

  // 중복 방지: 같은 사용자의 open 가설 중 cause/effect 가 같으면 다시 만들지 않는다.
  const { data: dup, error: dErr } = await supabase
    .from("hypotheses")
    .select("id")
    .eq("user_id", user.id)
    .eq("status", "open")
    .eq("cause_hint", c)
    .eq("effect_hint", e)
    .maybeSingle();
  if (dErr) return { ok: false, error: dErr.message };
  if (dup) return { ok: true }; // 이미 저장됨 — 멱등

  const statement = `${c} 가 ${e} 에 영향을 주나?`;
  const { error } = await supabase.from("hypotheses").insert({
    user_id: user.id,
    statement,
    recent_statement: statement,
    cause_hint: c,
    effect_hint: e,
    mention_count: 1,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/hypotheses");
  revalidatePath("/");
  return { ok: true };
}

// ── 성찰 응답 ("같이 생각해보기") ─────────────────────────────────────────────
export interface ReflectionReplyResult {
  ok: boolean;
  reply?: string;
  error?: string;
}

/** KST 시각대 라벨. 성찰을 적은 시간대 분포를 사실로 제공할 때 쓴다. */
function kstPartOfDay(iso: string): "새벽" | "아침" | "오후" | "저녁" | "밤" {
  const h = new Date(Date.parse(iso) + 9 * 60 * 60 * 1000).getUTCHours();
  if (h < 6) return "새벽";
  if (h < 12) return "아침";
  if (h < 18) return "오후";
  if (h < 22) return "저녁";
  return "밤";
}

/**
 * 사용자의 성찰 기록에서 **코드가 계산한 사실**만 만든다(모델이 지어내지 않게). 지금은 성찰을
 * 적은 시간대 분포. 표본이 적으면(3개 미만) 빈 문자열 — 억지 연결을 피한다.
 */
async function buildReflectionFacts(supabase: SupabaseClient, userId: string): Promise<string> {
  const { data } = await supabase
    .from("reflections")
    .select("raw_entries(recorded_at)")
    .eq("user_id", userId)
    .limit(300);
  const rows = (data ?? []) as {
    raw_entries: { recorded_at: string } | { recorded_at: string }[] | null;
  }[];
  const times = rows
    .map((r) => (Array.isArray(r.raw_entries) ? r.raw_entries[0] : r.raw_entries)?.recorded_at)
    .filter((t): t is string => !!t);
  if (times.length < 3) return "";

  const counts = new Map<string, number>();
  for (const t of times) {
    const p = kstPartOfDay(t);
    counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  const dist = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([p, n]) => `${p} ${n}개`)
    .join(", ");
  return `이 사용자가 성찰을 적은 시간대(지금까지 ${times.length}개): ${dist}`;
}

/**
 * 성찰에 대한 응답을 만들어 저장하고 돌려준다. **버튼을 눌러 요청했을 때만** 호출된다.
 * 이미 응답이 있으면 그걸 돌려준다(중복 LLM 호출·과금 방지). reflection_replies 는 파생 데이터가
 * 아니라 재파싱해도 지워지지 않는다. (0012)
 */
export async function replyToReflection(
  rawEntryId: string,
  reflectionText: string,
): Promise<ReflectionReplyResult> {
  const supabase = getSupabaseClient();
  const user = await currentWebUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  const text = reflectionText.trim();
  if (!text) return { ok: false, error: "빈 성찰" };

  const { data: existing } = await supabase
    .from("reflection_replies")
    .select("reply")
    .eq("user_id", user.id)
    .eq("raw_entry_id", rawEntryId)
    .eq("reflection_text", text)
    .maybeSingle();
  if (existing) return { ok: true, reply: (existing as { reply: string }).reply };

  const facts = await buildReflectionFacts(supabase, user.id);

  let reply: string;
  try {
    reply = await generateReflectionReply(text, facts);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  if (!reply) return { ok: false, error: "응답을 만들지 못했어요" };

  const { error } = await supabase.from("reflection_replies").insert({
    user_id: user.id,
    raw_entry_id: rawEntryId,
    reflection_text: text,
    reply,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/");
  return { ok: true, reply };
}
