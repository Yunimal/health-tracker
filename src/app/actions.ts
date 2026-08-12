"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseClient } from "@/lib/db/client";
import { env } from "@/lib/env";
import { reparseEntry } from "@/lib/parser/persist";
import type { Category, RawEntry } from "@/lib/db/schema";

/**
 * 타임라인 웹의 서버 액션. 브라우저는 이 함수들만 호출한다.
 * 모든 비밀(service role key 등)은 서버에만 있고, INGEST_TOKEN 은 여기서 쓰지 않는다
 * (웹은 서버에서 DB 에 직접 접근하므로 클라이언트 번들에 어떤 토큰도 들어가지 않는다).
 */

export interface ActionResult {
  ok: boolean;
  error?: string;
}

function kstNowIso(): string {
  const kstMs = new Date().getTime() + 9 * 60 * 60 * 1000;
  return new Date(kstMs).toISOString().replace("Z", "+09:00");
}

/** 텍스트 원문을 저장하고(파싱 대조를 즉시 보려고) 파싱까지 마친 뒤 목록을 갱신한다. */
export async function createTextEntry(text: string): Promise<ActionResult> {
  if (text.trim().length === 0) return { ok: false, error: "빈 입력" };
  const supabase = getSupabaseClient();
  const userId = env.userId();

  const { data, error } = await supabase
    .from("raw_entries")
    .insert({ user_id: userId, transcript: text, source: "text", recorded_at: kstNowIso() })
    .select()
    .single();
  if (error) return { ok: false, error: error.message };

  // 단축어(비동기)와 달리 웹은 결과를 바로 보여주므로 파싱을 기다린다.
  // 파싱이 실패해도 원문은 이미 저장됐다(reparseEntry 가 parse_error 에 기록).
  await reparseEntry(supabase, userId, data as RawEntry);
  revalidatePath("/");
  return { ok: true };
}

/** 원문 1건을 다시 파싱한다(POST /api/parse 단건과 동일 경로). */
export async function reparseEntryById(rawEntryId: string): Promise<ActionResult> {
  const supabase = getSupabaseClient();
  const userId = env.userId();
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
  const userId = env.userId();
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
  const userId = env.userId();
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
  const userId = env.userId();
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
  const userId = env.userId();
  const { error } = await supabase
    .from("raw_entries")
    .update({ hidden_at: null })
    .eq("id", rawEntryId)
    .eq("user_id", userId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/");
  return { ok: true };
}
