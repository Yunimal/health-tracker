import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

/**
 * Supabase 서버 클라이언트 (싱글턴).
 *
 * Phase 0 는 인증이 없으므로 service role key 로 접속한다. (RLS 우회)
 * 향후 인증 도입 시 RLS 정책(0001_init.sql)과 함께 anon key 경로를 추가한다.
 *
 * 서버 전용. 클라이언트 번들에 import 하지 않는다.
 */
let client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!client) {
    client = createClient(env.supabaseUrl(), env.supabaseServiceRoleKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}
