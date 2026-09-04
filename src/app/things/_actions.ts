"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseClient } from "@/lib/db/client";
import { currentWebUser } from "@/lib/auth";
import type { ActionResult } from "@/app/actions";

/**
 * 두 thing 을 병합한다. winnerId 의 이름이 살아남고, loserId 는 삭제된다.
 *
 * 병합 절차:
 *  1. loser 의 mentions 를 winner 로 이전(upsert, 중복 시 무시).
 *  2. loser 삭제(cascade 로 남은 loser mentions 도 삭제).
 *  3. winner 의 aliases 에 loser 이름 + loser aliases 추가.
 *  4. winner 의 mention_count / first/last_seen_at 재계산.
 *
 * 잘못 합치면 되돌릴 방법이 없다. UI 에서 반드시 확인 다이얼로그를 거쳐야 한다.
 * 트랜잭션 없음 — 중간 실패 시 재파싱으로 복구한다(things 파생 데이터).
 */
export async function mergeThings(winnerId: string, loserId: string): Promise<ActionResult> {
  const supabase = getSupabaseClient();
  const user = await currentWebUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  const userId = user.id;

  // 두 thing 이 이 사용자 소유인지 확인.
  const { data: items, error: loadErr } = await supabase
    .from("things")
    .select("id, name, aliases")
    .eq("user_id", userId)
    .in("id", [winnerId, loserId]);
  if (loadErr) return { ok: false, error: loadErr.message };
  const things = (items ?? []) as { id: string; name: string; aliases: string[] }[];
  if (things.length !== 2) return { ok: false, error: "대상을 찾지 못했습니다" };

  const winner = things.find((t) => t.id === winnerId)!;
  const loser = things.find((t) => t.id === loserId)!;

  // loser 의 mentions 를 winner 로 이전.
  const { data: loserMentions, error: mErr } = await supabase
    .from("thing_mentions")
    .select("raw_entry_id, user_id, excerpt")
    .eq("thing_id", loserId);
  if (mErr) return { ok: false, error: mErr.message };

  if ((loserMentions ?? []).length > 0) {
    const rows = (loserMentions as { raw_entry_id: string; user_id: string; excerpt: string | null }[]).map(
      (m) => ({ thing_id: winnerId, raw_entry_id: m.raw_entry_id, user_id: m.user_id, excerpt: m.excerpt }),
    );
    const { error: upsErr } = await supabase
      .from("thing_mentions")
      .upsert(rows, { onConflict: "thing_id,raw_entry_id", ignoreDuplicates: true });
    if (upsErr) return { ok: false, error: upsErr.message };
  }

  // loser 삭제(cascade 로 loser 의 남은 mentions 도 삭제됨).
  const { error: delErr } = await supabase.from("things").delete().eq("id", loserId).eq("user_id", userId);
  if (delErr) return { ok: false, error: delErr.message };

  // winner aliases 갱신 — loser 의 이름·aliases 를 추가하고 중복 제거.
  const existing = new Set(winner.aliases);
  const toAdd = [loser.name, ...loser.aliases].filter((n) => n !== winner.name && !existing.has(n));
  if (toAdd.length > 0) {
    const { error: aliasErr } = await supabase
      .from("things")
      .update({ aliases: [...winner.aliases, ...toAdd] })
      .eq("id", winnerId);
    if (aliasErr) return { ok: false, error: aliasErr.message };
  }

  // winner mention_count / first/last_seen_at 재계산.
  const { data: wm, error: wmErr } = await supabase
    .from("thing_mentions")
    .select("created_at")
    .eq("thing_id", winnerId)
    .order("created_at", { ascending: true });
  if (wmErr) return { ok: false, error: wmErr.message };
  const rows2 = (wm ?? []) as { created_at: string }[];
  if (rows2.length > 0) {
    await supabase
      .from("things")
      .update({
        mention_count: rows2.length,
        first_seen_at: rows2[0]!.created_at,
        last_seen_at: rows2[rows2.length - 1]!.created_at,
      })
      .eq("id", winnerId);
  }

  revalidatePath("/things");
  return { ok: true };
}

/**
 * 병합 후보 쌍을 "다름"으로 거부한다. 같은 쌍을 다시 후보로 제안하지 않는다.
 * 쌍은 canonical order(작은 uuid 먼저)로 저장한다.
 */
export async function rejectThingMerge(thingAId: string, thingBId: string): Promise<ActionResult> {
  const supabase = getSupabaseClient();
  const user = await currentWebUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };

  // canonical order — check 제약(a < b)을 앱에서 보장한다.
  const [a, b] = [thingAId, thingBId].sort() as [string, string];
  const { error } = await supabase
    .from("thing_merge_rejections")
    .upsert({ user_id: user.id, thing_a_id: a, thing_b_id: b }, { onConflict: "user_id,thing_a_id,thing_b_id", ignoreDuplicates: true });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/things");
  return { ok: true };
}
