"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateEvent, deleteEvent } from "../actions";
import {
  CATEGORY_LABEL,
  CATEGORY_ICON,
  formatWhen,
  summarizeEvent,
  reviewReasons,
} from "@/lib/format";
import type { Category } from "@/lib/db/schema";
import type { TimelineEvent } from "@/lib/db/queries";

/** 교정 폼의 필드명을 읽기 쉽게(표시용). 없는 키는 그대로 보여준다. */
const FIELD_LABEL: Record<string, string> = {
  name: "이름",
  amount_text: "양(원문)",
  amount_value: "양(값)",
  label: "기분",
  valence: "긍·부정",
  arousal: "각성도",
  quality: "수면 질",
  interruptions: "깬 횟수",
  level: "기력",
  note: "메모",
  kind: "종류",
  cycle_day: "주기 일차",
  flow: "양",
  pain: "통증",
  bristol: "형태(브리스톨)",
  count: "횟수",
  dose_text: "용량(원문)",
  dose_value: "용량(값)",
  dose_unit: "단위",
  dose_from: "이전 용량",
  dose_to: "새 용량",
  duration_min: "시간(분)",
  distance_km: "거리(km)",
  intensity_text: "강도(원문)",
  controllable_text: "참을 수 있는지(원문)",
  part: "부위",
  description_text: "상태(원문)",
  since_text: "언제부터(원문)",
  self_rating: "직접 매긴 점수",
  rating_scale: "점수 만점",
  action_text: "관리 행위(원문)",
  product_text: "제품(원문)",
};

const CATEGORIES: Category[] = [
  "food",
  "mood",
  "sleep",
  "energy",
  "menstrual",
  "bowel",
  "medication",
  "activity",
  "appetite",
  "digestion",
  "body_condition",
  "body_care",
  "focus",
  "environment",
];

/** occurred_at(ISO, 대개 UTC) ↔ datetime-local. 입력창은 KST 벽시계로 취급한다. */
const toLocalInput = (iso: string) =>
  new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 16);
const fromLocalInput = (v: string) => `${v}:00+09:00`;

/** 카테고리별로 편집할 payload 주요 필드. */
type Fields = Record<string, string>;

function initFields(category: Category, p: Record<string, unknown>): Fields {
  const s = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : "");
  const n = (k: string) => (typeof p[k] === "number" ? String(p[k]) : "");
  switch (category) {
    case "food":
      return { name: s("name"), amount_text: s("amount_text"), amount_value: n("amount_value") };
    case "mood":
      return { label: s("label"), valence: n("valence"), arousal: n("arousal") };
    case "sleep":
      return { quality: n("quality"), interruptions: n("interruptions") };
    case "energy":
      return { level: n("level"), note: s("note") };
    case "menstrual":
      return {
        kind: s("kind"),
        cycle_day: n("cycle_day"),
        flow: s("flow"),
        pain: n("pain"),
        note: s("note"),
      };
    case "bowel":
      return { bristol: n("bristol"), count: n("count"), note: s("note") };
    case "medication":
      return {
        kind: s("kind"),
        name: s("name"),
        dose_text: s("dose_text"),
        dose_value: n("dose_value"),
        dose_unit: s("dose_unit"),
        dose_from: s("dose_from"),
        dose_to: s("dose_to"),
        note: s("note"),
      };
    case "activity":
      return {
        name: s("name"),
        duration_min: n("duration_min"),
        distance_km: n("distance_km"),
        intensity_text: s("intensity_text"),
        note: s("note"),
      };
    case "appetite":
      return {
        kind: s("kind"),
        intensity_text: s("intensity_text"),
        controllable_text: s("controllable_text"),
        note: s("note"),
      };
    case "digestion":
      return { kind: s("kind"), intensity_text: s("intensity_text"), note: s("note") };
    case "body_condition":
      return {
        part: s("part"),
        description_text: s("description_text"),
        since_text: s("since_text"),
        self_rating: n("self_rating"),
        rating_scale: n("rating_scale"),
        note: s("note"),
      };
    case "body_care":
      return {
        part: s("part"),
        action_text: s("action_text"),
        product_text: s("product_text"),
        note: s("note"),
      };
    case "focus":
      return { level: n("level"), note: s("note") };
    case "environment":
      return { kind: s("kind"), description_text: s("description_text"), note: s("note") };
  }
}

function buildPayload(
  category: Category,
  f: Fields,
  base: Record<string, unknown>,
): Record<string, unknown> {
  const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v));
  const strOrNull = (v: string) => (v.trim() === "" ? null : v);
  switch (category) {
    case "food":
      return {
        ...base,
        name: strOrNull(f.name!),
        amount_text: strOrNull(f.amount_text!),
        amount_value: numOrNull(f.amount_value!),
      };
    case "mood":
      return {
        ...base,
        label: f.label ?? "",
        valence: numOrNull(f.valence!) ?? 0,
        arousal: numOrNull(f.arousal!) ?? 0,
      };
    case "sleep":
      return {
        ...base,
        quality: numOrNull(f.quality!),
        interruptions: numOrNull(f.interruptions!),
      };
    case "energy":
      return { ...base, level: numOrNull(f.level!) ?? 3, note: strOrNull(f.note!) };
    case "menstrual":
      return {
        ...base,
        kind: f.kind || "ongoing",
        cycle_day: numOrNull(f.cycle_day!),
        flow: strOrNull(f.flow!),
        pain: numOrNull(f.pain!),
        note: strOrNull(f.note!),
      };
    case "bowel":
      return {
        ...base,
        bristol: numOrNull(f.bristol!),
        count: numOrNull(f.count!),
        note: strOrNull(f.note!),
      };
    case "medication":
      return {
        ...base,
        kind: f.kind || "taken",
        name: f.name ?? "",
        dose_text: strOrNull(f.dose_text!),
        dose_value: numOrNull(f.dose_value!),
        dose_unit: strOrNull(f.dose_unit!),
        dose_from: strOrNull(f.dose_from!),
        dose_to: strOrNull(f.dose_to!),
        note: strOrNull(f.note!),
      };
    case "activity":
      return {
        ...base,
        name: f.name ?? "",
        duration_min: numOrNull(f.duration_min!),
        distance_km: numOrNull(f.distance_km!),
        intensity_text: strOrNull(f.intensity_text!),
        note: strOrNull(f.note!),
      };
    case "appetite":
      return {
        ...base,
        kind: f.kind || "hunger",
        intensity_text: strOrNull(f.intensity_text!),
        controllable_text: strOrNull(f.controllable_text!),
        note: strOrNull(f.note!),
      };
    case "digestion":
      return {
        ...base,
        kind: f.kind || "other",
        intensity_text: strOrNull(f.intensity_text!),
        note: strOrNull(f.note!),
      };
    case "body_condition":
      return {
        ...base,
        part: f.part || "other",
        description_text: f.description_text ?? "",
        since_text: strOrNull(f.since_text!),
        self_rating: numOrNull(f.self_rating!),
        rating_scale: numOrNull(f.rating_scale!),
        note: strOrNull(f.note!),
      };
    case "body_care":
      return {
        ...base,
        part: f.part || "other",
        action_text: f.action_text ?? "",
        product_text: strOrNull(f.product_text!),
        note: strOrNull(f.note!),
      };
    case "focus":
      return { ...base, level: numOrNull(f.level!) ?? 3, note: strOrNull(f.note!) };
    case "environment":
      return {
        ...base,
        kind: f.kind || "other",
        description_text: f.description_text ?? "",
        note: strOrNull(f.note!),
      };
  }
}

export default function EventItem({ event }: { event: TimelineEvent }) {
  const [editing, setEditing] = useState(false);
  const [showReason, setShowReason] = useState(false);
  const [category, setCategory] = useState<Category>(event.category);
  const [when, setWhen] = useState(toLocalInput(event.occurred_at));
  const [fields, setFields] = useState<Fields>(() => initFields(event.category, event.payload));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function open() {
    setCategory(event.category);
    setWhen(toLocalInput(event.occurred_at));
    setFields(initFields(event.category, event.payload));
    setError(null);
    setEditing(true);
  }

  function changeCategory(next: Category) {
    setCategory(next);
    // 카테고리가 바뀌면 그 카테고리 필드로 초기화(원래와 같으면 기존 payload 유지).
    setFields(initFields(next, next === event.category ? event.payload : {}));
  }

  function setField(k: string, v: string) {
    setFields((f) => ({ ...f, [k]: v }));
  }

  function save() {
    setError(null);
    const base = category === event.category ? event.payload : {};
    const payload = buildPayload(category, fields, base);
    start(async () => {
      const res = await updateEvent({
        id: event.id,
        category,
        occurred_at: fromLocalInput(when),
        payload,
      });
      if (res.ok) {
        setEditing(false);
        router.refresh();
      } else {
        setError(res.error ?? "저장 실패");
      }
    });
  }

  function remove() {
    setError(null);
    start(async () => {
      const res = await deleteEvent(event.id);
      if (res.ok) router.refresh();
      else setError(res.error ?? "삭제 실패");
    });
  }

  if (!editing) {
    const reasons = event.needs_review ? reviewReasons(event) : [];
    const border = event.needs_review ? "border-amber-400" : "border-gray-200";
    return (
      <div className={`rounded border ${border}`}>
        <div className="flex items-stretch">
          {/* 한 줄 요약 — 탭하면 상세/교정 UI 가 열린다. */}
          <button
            onClick={open}
            className="flex min-w-0 flex-1 items-start gap-2 rounded-l px-2 py-1.5 text-left hover:bg-gray-50"
          >
            <span className="shrink-0 text-sm leading-5" aria-hidden>
              {CATEGORY_ICON[event.category]}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm">{summarizeEvent(event.category, event.payload)}</span>
              <span className="block text-[11px] text-gray-400">
                {CATEGORY_LABEL[event.category]} ·{" "}
                {formatWhen(event.occurred_at, event.occurred_at_precision)}
                {event.corrected_by_user && " · 교정됨"}
              </span>
            </span>
          </button>

          {/* 확인 필요 칩 — 누르면 이유를 펼친다(교정과 별개). */}
          {event.needs_review && (
            <button
              onClick={() => setShowReason((v) => !v)}
              aria-expanded={showReason}
              className="m-1 shrink-0 self-start rounded-full border border-amber-400 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700 hover:bg-amber-100"
            >
              확인 필요
            </button>
          )}
        </div>

        {showReason && event.needs_review && (
          <p className="border-t border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-700">
            {reasons.length ? reasons.join(" · ") : "값을 한 번 확인해 주세요"}
          </p>
        )}
      </div>
    );
  }

  const editBorder = event.needs_review ? "border-amber-400 bg-amber-50" : "border-gray-200";

  return (
    <div className={`rounded border ${editBorder} p-2`}>
      <div className="flex flex-wrap gap-2">
        <select
          value={category}
          onChange={(e) => changeCategory(e.target.value as Category)}
          className="rounded border border-gray-300 px-1 py-0.5 text-sm"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
        <input
          type="datetime-local"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
          className="rounded border border-gray-300 px-1 py-0.5 text-sm"
        />
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        {Object.keys(fields).map((k) => (
          <label key={k} className="flex flex-col text-[11px] text-gray-600">
            {FIELD_LABEL[k] ?? k}
            <input
              value={fields[k] ?? ""}
              onChange={(e) => setField(k, e.target.value)}
              className="rounded border border-gray-300 px-1 py-0.5 text-sm text-gray-900"
            />
          </label>
        ))}
      </div>

      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}

      <div className="mt-2 flex gap-2">
        <button
          onClick={save}
          disabled={pending}
          className="rounded bg-gray-900 px-3 py-0.5 text-xs text-white disabled:opacity-40"
        >
          저장
        </button>
        <button
          onClick={() => setEditing(false)}
          disabled={pending}
          className="rounded border border-gray-300 px-3 py-0.5 text-xs hover:bg-gray-100"
        >
          취소
        </button>
        <button
          onClick={remove}
          disabled={pending}
          className="ml-auto rounded border border-red-300 px-3 py-0.5 text-xs text-red-600 hover:bg-red-50"
        >
          삭제
        </button>
      </div>
    </div>
  );
}
