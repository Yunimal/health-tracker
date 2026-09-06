import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { currentWebUser } from "@/lib/auth";
import { getThingDetail } from "@/lib/db/queries";
import { relativeDay, CATEGORY_ICON, CATEGORY_LABEL, summarizeEvent, formatWhen } from "@/lib/format";
import UserBar from "../../_components/UserBar";
import NoteEditor from "./_components/NoteEditor";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  treatment: "시술",
  product: "제품",
  place: "장소",
  regimen: "루틴",
};

const KIND_COLOR: Record<string, string> = {
  treatment: "border-indigo-200 bg-indigo-50 text-indigo-700",
  product: "border-blue-200 bg-blue-50 text-blue-700",
  place: "border-green-200 bg-green-50 text-green-700",
  regimen: "border-orange-200 bg-orange-50 text-orange-700",
};

const HYP_STATUS_LABEL: Record<string, string> = {
  open: "미결",
  supported: "지지됨",
  not_supported: "반박됨",
  dismissed: "기각",
};

export default async function ThingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await currentWebUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const detail = await getThingDetail(user.id, id);
  if (!detail) notFound();

  const { thing: t, mentions, relatedEvents, relatedHypotheses } = detail;

  const firstSeen = t.first_seen_at ? relativeDay(t.first_seen_at) : null;
  const lastSeen = t.last_seen_at ? relativeDay(t.last_seen_at) : null;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-4">
      {/* ── 헤더 ─────────────────────────────────────────────────────── */}
      <header className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <Link href="/things" className="text-sm text-gray-500 hover:text-gray-700">
            ← 대상 목록
          </Link>
          <UserBar label={user.label} />
        </div>

        <div className="rounded-lg border border-gray-200 px-4 py-3">
          <div className="flex flex-wrap items-baseline gap-2">
            <h1 className="text-lg font-semibold">{t.name}</h1>
            <span
              className={`inline-block rounded border px-1.5 py-0 text-[10px] ${KIND_COLOR[t.kind] ?? ""}`}
            >
              {KIND_LABEL[t.kind] ?? t.kind}
            </span>
          </div>

          {t.aliases.length > 0 && (
            <p className="mt-0.5 text-[11px] text-gray-400">= {t.aliases.join(", ")}</p>
          )}

          {/* 요약 수치 */}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-gray-500">
            <span>총 언급 {t.mention_count}건</span>
            {firstSeen && <span>처음 {firstSeen}</span>}
            {lastSeen && firstSeen !== lastSeen && <span>마지막 {lastSeen}</span>}
          </div>
        </div>
      </header>

      {/* ── 메모 ─────────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-1.5">
        <h2 className="text-sm font-medium text-gray-700">메모</h2>
        <NoteEditor thingId={t.id} initialNote={t.note} />
      </section>

      {/* ── 언급 이력 ─────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-gray-700">언급 이력</h2>

        {mentions.length === 0 ? (
          <p className="py-4 text-center text-sm text-gray-400">언급 기록이 없습니다.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {mentions.map((m) => (
              <li
                key={m.id}
                className="rounded-lg border border-gray-200 px-3 py-2.5"
              >
                {/* 날짜 + 원문 링크 */}
                <div className="mb-1.5 flex items-baseline justify-between gap-2">
                  <span className="text-[11px] text-gray-400">
                    {m.recorded_at ? relativeDay(m.recorded_at) : "날짜 미상"}
                  </span>
                  {m.kst_date && (
                    <Link
                      href={`/?date=${m.kst_date}`}
                      className="text-[11px] text-gray-400 hover:text-gray-600 hover:underline"
                    >
                      원문 보기 →
                    </Link>
                  )}
                </div>

                {/* 발췌문 또는 원문 (CLAUDE.md 원칙 6: 판단 없이 원문 그대로) */}
                <p className="text-sm leading-relaxed text-gray-800">
                  {m.excerpt ?? m.transcript}
                </p>

                {/* 이 원문에서 나온 관련 이벤트 */}
                {m.events.length > 0 && (
                  <ul className="mt-2 flex flex-col gap-1 border-t border-gray-100 pt-2">
                    {m.events.map((e) => (
                      <li key={e.id} className="flex items-start gap-1.5">
                        <span className="shrink-0 text-sm leading-5" aria-hidden>
                          {CATEGORY_ICON[e.category]}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm">{summarizeEvent(e.category, e.payload)}</span>
                          <span className="block text-[11px] text-gray-400">
                            {CATEGORY_LABEL[e.category]} · {formatWhen(e.occurred_at, e.occurred_at_precision)}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── 관련 이벤트 ──────────────────────────────────────────────── */}
      {relatedEvents.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-gray-700">
            관련 이벤트{" "}
            <span className="text-[11px] font-normal text-gray-400">
              ({relatedEvents.length}건 · 이름 일치)
            </span>
          </h2>
          <ul className="flex flex-col gap-1.5">
            {relatedEvents.map((e) => (
              <li
                key={e.id}
                className="flex items-start gap-2 rounded-lg border border-gray-100 px-3 py-2"
              >
                <span className="shrink-0 text-sm leading-5" aria-hidden>
                  {CATEGORY_ICON[e.category]}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm">{summarizeEvent(e.category, e.payload)}</span>
                  <span className="block text-[11px] text-gray-400">
                    {CATEGORY_LABEL[e.category]} · {relativeDay(e.occurred_at)} {formatWhen(e.occurred_at, e.occurred_at_precision)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── 관련 가설 ─────────────────────────────────────────────────── */}
      {relatedHypotheses.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-gray-700">관련 가설</h2>
          <ul className="flex flex-col gap-1.5">
            {relatedHypotheses.map((h) => (
              <li key={h.id}>
                <Link
                  href={`/hypotheses/${h.id}`}
                  className="flex flex-col gap-0.5 rounded-lg border border-gray-200 px-3 py-2 hover:border-gray-300"
                >
                  <span className="text-sm">{h.statement}</span>
                  <span className="text-[11px] text-gray-400">
                    {HYP_STATUS_LABEL[h.status] ?? h.status} · {h.mention_count}번 의심
                    {(h.cause_hint || h.effect_hint) && (
                      <> · {h.cause_hint ?? "?"} → {h.effect_hint ?? "?"}</>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
