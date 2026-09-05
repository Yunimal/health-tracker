import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseClient } from "@/lib/db/client";
import { userFromRequest } from "@/lib/auth";
import { PARSE_VERSION } from "@/lib/parser";
import { THING_EXTRACT_VERSION } from "@/lib/parser/thing-extract";
import type { SleepPayload, RawEntryInsert } from "@/lib/db/schema";

/**
 * POST /api/sleep — 워치(기기) 수면 데이터 직접 저장.
 *
 * LLM 파싱 없음. 측정값을 그대로 sleep 이벤트로 저장한다. 비용도 없고 틀릴 일도 없다.
 *
 * 인증: Authorization: Bearer <ingest_token> (entries API 와 동일)
 * 멱등: 같은 date 로 다시 오면 기존 device 수면 이벤트만 교체한다.
 *       self 기록(사용자가 말한 수면 느낌)은 건드리지 않는다.
 * 저장: raw_entries 에 요약 문자열을 기록(감사 추적)하고 events 에 sleep 이벤트를 직접 생성.
 */

const bodySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  score: z.number().int().min(0).max(100).nullable().optional(),
  total_minutes: z.number().int().min(0).nullable().optional(),
  bedtime: z.string().nullable().optional(),
  wake_time: z.string().nullable().optional(),
  interruptions: z.number().int().min(0).nullable().optional(),
  awake_minutes: z.number().int().min(0).nullable().optional(),
  deep_minutes: z.number().int().min(0).nullable().optional(),
  rem_minutes: z.number().int().min(0).nullable().optional(),
  core_minutes: z.number().int().min(0).nullable().optional(),
});

/** raw_entries.transcript 에 저장할 사람이 읽을 수 있는 요약 */
function buildTranscript(date: string, b: z.infer<typeof bodySchema>): string {
  const parts: string[] = [`워치 수면 ${date}`];
  if (b.score != null) parts.push(`점수 ${b.score}`);
  if (b.total_minutes != null) {
    const h = Math.floor(b.total_minutes / 60);
    const m = b.total_minutes % 60;
    parts.push(`총 수면 ${h}시간${m > 0 ? ` ${m}분` : ""}`);
  }
  if (b.deep_minutes != null) parts.push(`깊은잠 ${b.deep_minutes}분`);
  if (b.rem_minutes != null) parts.push(`REM ${b.rem_minutes}분`);
  if (b.core_minutes != null) parts.push(`코어 ${b.core_minutes}분`);
  if (b.awake_minutes != null) parts.push(`뒤척임 ${b.awake_minutes}분`);
  if (b.bedtime) parts.push(`취침 ${b.bedtime}`);
  if (b.wake_time) parts.push(`기상 ${b.wake_time}`);
  return parts.join(", ");
}

export async function POST(request: Request): Promise<NextResponse> {
  const user = await userFromRequest(request);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const result = bodySchema.safeParse(raw);
  if (!result.success) {
    return NextResponse.json(
      { error: "invalid_body", issues: result.error.issues },
      { status: 400 },
    );
  }

  const b = result.data;
  const { date } = b;
  const supabase = getSupabaseClient();

  // 1. 같은 날 device 수면 이벤트 ID 목록 조회 (나중에 삭제할 것 — insert-before-delete)
  //    self 기록은 건드리지 않는다.
  const { data: existing } = await supabase
    .from("events")
    .select("id, payload")
    .eq("user_id", user.id)
    .eq("category", "sleep")
    .gte("occurred_at", `${date}T00:00:00+09:00`)
    .lte("occurred_at", `${date}T23:59:59.999+09:00`);

  const oldDeviceIds = ((existing ?? []) as { id: string; payload: Record<string, unknown> }[])
    .filter((e) => e.payload.source === "device")
    .map((e) => e.id);

  // 2. raw_entry 생성 (요약 문자열로 감사 추적).
  //    parse_version / thing_extract_version 을 현재 버전으로 채워 재처리 스크립트가
  //    이 항목을 건드리지 않도록 한다.
  const now = new Date().toISOString();
  const insert: RawEntryInsert = {
    user_id: user.id,
    transcript: buildTranscript(date, b),
    source: "device",
    recorded_at: now,
    parse_version: PARSE_VERSION,
    parsed_at: now,
    thing_extract_version: THING_EXTRACT_VERSION,
  };

  const { data: entry, error: entryErr } = await supabase
    .from("raw_entries")
    .insert(insert)
    .select("id")
    .single();

  if (entryErr || !entry) {
    return NextResponse.json(
      { error: "db_error", detail: entryErr?.message },
      { status: 500 },
    );
  }

  // 3. sleep 이벤트 직접 INSERT (LLM 없음 — 측정값을 그대로 payload 에 넣는다)
  //    occurred_at: wake_time 이 있으면 그 시각, 없으면 해당 날짜 오전 8시(기상 기본값).
  const occurredAt = b.wake_time ?? `${date}T08:00:00+09:00`;
  const payload: SleepPayload = {
    bedtime: b.bedtime ?? null,
    wake_time: b.wake_time ?? null,
    quality: null,
    interruptions: b.interruptions ?? null,
    note: null,
    source: "device",
    score: b.score ?? null,
    total_minutes: b.total_minutes ?? null,
    awake_minutes: b.awake_minutes ?? null,
    deep_minutes: b.deep_minutes ?? null,
    rem_minutes: b.rem_minutes ?? null,
    core_minutes: b.core_minutes ?? null,
  };

  const { error: eventErr } = await supabase.from("events").insert({
    user_id: user.id,
    raw_entry_id: entry.id,
    category: "sleep",
    occurred_at: occurredAt,
    occurred_at_precision: b.wake_time ? "exact" : "date",
    confidence: 1,
    needs_review: false,
    payload,
  });

  if (eventErr) {
    return NextResponse.json(
      { error: "db_error", detail: eventErr.message },
      { status: 500 },
    );
  }

  // 4. 구 device 이벤트 삭제 (새 이벤트가 성공한 뒤에 삭제 — insert-before-delete)
  if (oldDeviceIds.length > 0) {
    await supabase.from("events").delete().in("id", oldDeviceIds);
  }

  return NextResponse.json({
    ok: true,
    replaced: oldDeviceIds.length,
    entry_id: (entry as { id: string }).id,
  });
}
