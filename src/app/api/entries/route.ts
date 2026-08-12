import { NextResponse, after } from "next/server";
import { z } from "zod";
import { getSupabaseClient } from "@/lib/db/client";
import { env } from "@/lib/env";
import { reparseEntry } from "@/lib/parser/persist";
import type { RawEntry, RawEntryInsert } from "@/lib/db/schema";

/**
 * /api/entries — 원문 수신/조회 엔드포인트. (기획서 §7)
 *
 * 인증: Authorization: Bearer {INGEST_TOKEN}. 없거나 틀리면 401. (POST/GET 공통)
 * 원칙: transcript(원문)는 저장 후 절대 UPDATE/DELETE 하지 않는다. (기획서 §5.1)
 */

// ── 인증 ─────────────────────────────────────────────────────────────────────
/** 길이 노출을 제외하고 타이밍에 무관한 문자열 비교. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

/** Bearer 토큰이 INGEST_TOKEN 과 일치하지 않으면 401 응답을, 통과면 null 을 반환한다. */
function requireIngestToken(request: Request): NextResponse | null {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1];
  if (!token || !safeEqual(token, env.ingestToken())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}

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
  const authError = requireIngestToken(request);
  if (authError) return authError;

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

  // 원문 저장에 성공했으면 파싱을 백그라운드로 트리거하고 즉시 201 을 반환한다.
  // 단축어가 빨리 끝나야 하므로 파싱을 기다리지 않는다. 파싱이 실패해도 원문은 이미
  // 저장됐으므로 201 은 유지된다(재파싱은 나중에 /api/parse 로 가능). (기획서 §7)
  const entry = data as RawEntry;
  try {
    after(async () => {
      try {
        await reparseEntry(getSupabaseClient(), env.userId(), entry);
      } catch (err) {
        console.error(`[entries] 백그라운드 파싱 실패 (raw_entry ${entry.id}):`, err);
      }
    });
  } catch (err) {
    // after() 가 요청 스코프 밖(예: 단위 테스트)에서 호출되면 스케줄만 건너뛴다.
    console.warn("[entries] after() 스케줄 생략:", err);
  }

  return NextResponse.json({ entry: data }, { status: 201 });
}

// ── GET: 날짜별 조회 ────────────────────────────────────────────────────────
const DateQuery = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
});

export async function GET(request: Request): Promise<NextResponse> {
  const authError = requireIngestToken(request);
  if (authError) return authError;

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
