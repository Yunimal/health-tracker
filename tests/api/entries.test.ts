import { describe, it, expect, vi, beforeEach } from "vitest";

// DB 와 env 는 실제로 붙이지 않고 mock 한다.
vi.mock("@/lib/db/client", () => ({ getSupabaseClient: vi.fn() }));
vi.mock("@/lib/env", () => ({
  env: {
    userId: () => "user-123",
    supabaseUrl: () => "http://mock",
    supabaseServiceRoleKey: () => "mock-key",
    anthropicApiKey: () => "mock-anthropic",
  },
}));

import { getSupabaseClient } from "@/lib/db/client";
import { POST, GET } from "@/app/api/entries/route";

type Result = { data: unknown; error: { message: string } | null };

/** supabase 쿼리 빌더를 흉내내는 체이너블 mock. 호출 인자를 기록한다. */
function makeSupabase(result: Result) {
  const calls: Record<string, unknown[][]> = {};
  const record = (name: string, args: unknown[]) => {
    (calls[name] ??= []).push(args);
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {};
  for (const m of ["insert", "select", "eq", "gte", "lt", "order"]) {
    builder[m] = vi.fn((...args: unknown[]) => {
      record(m, args);
      return builder;
    });
  }
  builder.single = vi.fn((...args: unknown[]) => {
    record("single", args);
    return Promise.resolve(result);
  });
  // GET 은 .order() 로 끝나는 체인을 await 하므로 builder 를 thenable 로 만든다.
  builder.then = (resolve: (v: Result) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  const from = vi.fn((table: string) => {
    record("from", [table]);
    return builder;
  });
  return { client: { from }, calls };
}

function useSupabase(result: Result) {
  const mock = makeSupabase(result);
  vi.mocked(getSupabaseClient).mockReturnValue(mock.client as never);
  return mock;
}

function postReq(body: unknown, rawJson?: string) {
  return new Request("http://localhost/api/entries", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: rawJson ?? JSON.stringify(body),
  });
}

function getReq(query: string) {
  return new Request(`http://localhost/api/entries${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/entries", () => {
  it("유효한 body 를 저장하고 201 을 반환한다", async () => {
    const row = { id: "e1", transcript: "커피 한 모금" };
    const mock = useSupabase({ data: row, error: null });

    const res = await POST(
      postReq({
        transcript: "커피 한 모금",
        recorded_at: "2026-08-10T09:00:00+09:00",
        source: "voice",
      }),
    );

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ entry: row });
    expect(mock.calls.from?.[0]).toEqual(["raw_entries"]);
    expect(mock.calls.insert?.[0]?.[0]).toEqual({
      user_id: "user-123",
      transcript: "커피 한 모금",
      source: "voice",
      recorded_at: "2026-08-10T09:00:00+09:00",
    });
  });

  it("recorded_at 이 없으면 서버 KST 시각을 사용한다", async () => {
    const mock = useSupabase({ data: { id: "e2" }, error: null });

    const res = await POST(postReq({ transcript: "물 마심", source: "text" }));

    expect(res.status).toBe(201);
    const insertArg = mock.calls.insert?.[0]?.[0] as { recorded_at: string };
    expect(insertArg.recorded_at).toMatch(/\+09:00$/);
  });

  it("transcript 가 빈 문자열이면 400 이고 INSERT 하지 않는다", async () => {
    const mock = useSupabase({ data: null, error: null });

    const res = await POST(postReq({ transcript: "", source: "voice" }));

    expect(res.status).toBe(400);
    expect(mock.calls.insert).toBeUndefined();
  });

  it("transcript 가 공백뿐이면 400 이다", async () => {
    useSupabase({ data: null, error: null });
    const res = await POST(postReq({ transcript: "   ", source: "voice" }));
    expect(res.status).toBe(400);
  });

  it("source 가 허용값이 아니면 400 이다", async () => {
    useSupabase({ data: null, error: null });
    const res = await POST(postReq({ transcript: "밥 먹음", source: "email" }));
    expect(res.status).toBe(400);
  });

  it("본문이 유효한 JSON 이 아니면 400 이다", async () => {
    useSupabase({ data: null, error: null });
    const res = await POST(postReq(null, "{ not json"));
    expect(res.status).toBe(400);
  });

  it("DB 오류 시 500 을 반환한다", async () => {
    useSupabase({ data: null, error: { message: "boom" } });
    const res = await POST(postReq({ transcript: "밥 먹음", source: "voice" }));
    expect(res.status).toBe(500);
  });
});

describe("GET /api/entries", () => {
  it("해당 날짜의 KST 구간으로 조회하고 200 을 반환한다", async () => {
    const rows = [{ id: "e1" }, { id: "e2" }];
    const mock = useSupabase({ data: rows, error: null });

    const res = await GET(getReq("?date=2026-08-10"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ entries: rows });
    expect(mock.calls.eq?.[0]).toEqual(["user_id", "user-123"]);
    expect(mock.calls.gte?.[0]).toEqual(["recorded_at", "2026-08-09T15:00:00.000Z"]);
    expect(mock.calls.lt?.[0]).toEqual(["recorded_at", "2026-08-10T15:00:00.000Z"]);
    expect(mock.calls.order?.[0]).toEqual(["recorded_at", { ascending: true }]);
  });

  it("date 파라미터가 없으면 400 이다", async () => {
    useSupabase({ data: [], error: null });
    const res = await GET(getReq(""));
    expect(res.status).toBe(400);
  });

  it("date 형식이 잘못되면 400 이다", async () => {
    useSupabase({ data: [], error: null });
    const res = await GET(getReq("?date=2026/08/10"));
    expect(res.status).toBe(400);
  });

  it("DB 오류 시 500 을 반환한다", async () => {
    useSupabase({ data: null, error: { message: "boom" } });
    const res = await GET(getReq("?date=2026-08-10"));
    expect(res.status).toBe(500);
  });
});
