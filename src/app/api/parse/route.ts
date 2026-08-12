import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseClient } from "@/lib/db/client";
import { env } from "@/lib/env";
import { reparseEntry, type EntryOutcome } from "@/lib/parser/persist";
import type { RawEntry } from "@/lib/db/schema";

/**
 * POST /api/parse — 파싱 트리거 (수동/배치 재파싱).
 *
 * body: { raw_entry_id } (단건) 또는 { batch: true, since? } (배치 재파싱)
 * 재파싱 규칙과 파생 데이터 생명주기는 reparseEntry(@/lib/parser/persist) 참고.
 */
const Body = z.union([
  z.object({ raw_entry_id: z.string().min(1) }),
  z.object({ batch: z.literal(true), since: z.iso.datetime({ offset: true }).optional() }),
]);

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const supabase = getSupabaseClient();
  const userId = env.userId();

  // ── 단건 ────────────────────────────────────────────────────────────────
  if ("raw_entry_id" in parsed.data) {
    const { data, error } = await supabase
      .from("raw_entries")
      .select("*")
      .eq("id", parsed.data.raw_entry_id)
      .eq("user_id", userId)
      .single();
    if (error || !data) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const outcome = await reparseEntry(supabase, userId, data as RawEntry);
    return NextResponse.json({ result: outcome }, { status: 200 });
  }

  // ── 배치 ────────────────────────────────────────────────────────────────
  let query = supabase.from("raw_entries").select("*").eq("user_id", userId);
  if (parsed.data.since) query = query.gte("created_at", parsed.data.since);
  const { data, error } = await query.order("created_at", { ascending: true });
  if (error) {
    return NextResponse.json({ error: "query_failed", detail: error.message }, { status: 500 });
  }

  const results: EntryOutcome[] = [];
  for (const entry of (data ?? []) as RawEntry[]) {
    // 발화당 1회 호출 원칙에 따라 순차 처리한다. (기획서 §10)
    // 배치는 같은 프롬프트로 연속 호출하므로 프롬프트 캐싱을 켠다.
    results.push(await reparseEntry(supabase, userId, entry, { cachePrompt: true }));
  }
  const failed = results.filter((r) => !r.ok).length;
  return NextResponse.json({ count: results.length, failed, results }, { status: 200 });
}
