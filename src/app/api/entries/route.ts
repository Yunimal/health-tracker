import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseClient } from "@/lib/db/client";
import { env } from "@/lib/env";
import type { RawEntryInsert } from "@/lib/db/schema";

/**
 * /api/entries — 원문 수신/조회 엔드포인트.
 *
 * 원칙: transcript(원문)는 저장 후 절대 UPDATE/DELETE 하지 않는다. (기획서 §5.1)
 * 파싱은 여기서 하지 않는다. (별도 트리거)
 */

// ── POST: 원문 수신 ─────────────────────────────────────────────────────────
const PostBody = z.object({
  // 빈 문자열/공백만 있는 값은 거부하되, 저장은 원문 그대로 한다.
  transcript: z.string().refine((s) => s.trim().length > 0, {
    message: "transcript must not be empty",
  }),
  recorded_at: z.iso.datetime({ offset: true }).optional(),
  source: z.enum(["voice", "text"]),
});

/** recorded_at 미지정 시 사용할 서버 시각을 KST(+09:00) ISO8601 로 만든다. */
function kstNowIso(): string {
  const kstMs = new Date().getTime() + 9 * 60 * 60 * 1000;
  return new Date(kstMs).toISOString().replace("Z", "+09:00");
}

export async function POST(request: Request): Promise<NextResponse> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = PostBody.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const insert: RawEntryInsert = {
    user_id: env.userId(),
    transcript: parsed.data.transcript,
    source: parsed.data.source,
    recorded_at: parsed.data.recorded_at ?? kstNowIso(),
  };

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from("raw_entries").insert(insert).select().single();

  if (error) {
    return NextResponse.json({ error: "insert_failed", detail: error.message }, { status: 500 });
  }

  return NextResponse.json({ entry: data }, { status: 201 });
}

// ── GET: 날짜별 조회 ────────────────────────────────────────────────────────
const DateQuery = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
});

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const parsed = DateQuery.safeParse({ date: url.searchParams.get("date") });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_query", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  // KST 기준 하루 구간 [00:00, 다음날 00:00) 로 recorded_at 을 필터한다.
  const dayStart = new Date(`${parsed.data.date}T00:00:00+09:00`);
  if (Number.isNaN(dayStart.getTime())) {
    return NextResponse.json({ error: "invalid_date" }, { status: 400 });
  }
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("raw_entries")
    .select("*")
    .eq("user_id", env.userId())
    .gte("recorded_at", dayStart.toISOString())
    .lt("recorded_at", dayEnd.toISOString())
    .order("recorded_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: "query_failed", detail: error.message }, { status: 500 });
  }

  return NextResponse.json({ entries: data ?? [] }, { status: 200 });
}
