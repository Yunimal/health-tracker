"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateEvent, deleteEvent } from "../actions";
import { CATEGORY_LABEL, formatWhen, summarizePayload } from "@/lib/format";
import type { Category } from "@/lib/db/schema";
import type { TimelineEvent } from "@/lib/db/queries";

const CATEGORIES: Category[] = [
  "food",
  "mood",
  "sleep",
  "energy",
  "menstrual",
  "bowel",
  "medication",
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
  }
}

export default function EventItem({ event }: { event: TimelineEvent }) {
  const [editing, setEditing] = useState(false);
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

  const border = event.needs_review ? "border-amber-400 bg-amber-50" : "border-gray-200";

  if (!editing) {
    return (
      <button
        onClick={open}
        className={`flex w-full items-start gap-2 rounded border ${border} px-2 py-1 text-left hover:bg-gray-50`}
      >
        <span className="shrink-0 rounded border border-gray-400 px-1 text-[11px] leading-5 text-gray-700">
          {CATEGORY_LABEL[event.category]}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm">
            {summarizePayload(event.category, event.payload)}
          </span>
          <span className="block text-[11px] text-gray-500">
            {formatWhen(event.occurred_at, event.occurred_at_precision)} · conf{" "}
            {Number(event.confidence).toFixed(2)}
            {event.needs_review && " · 검토"}
            {event.corrected_by_user && " · 교정됨"}
          </span>
        </span>
      </button>
    );
  }

  return (
    <div className={`rounded border ${border} p-2`}>
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
            {k}
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
