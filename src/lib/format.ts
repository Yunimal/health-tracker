import type { Category } from "@/lib/db/schema";

/** UI 표시용 순수 헬퍼. 클라이언트/서버 양쪽에서 쓰므로 서버 전용 import 금지. */

export const CATEGORY_LABEL: Record<Category, string> = {
  food: "음식",
  mood: "기분",
  sleep: "수면",
  energy: "기력",
  menstrual: "생리",
  bowel: "배변",
  medication: "약",
};

const str = (p: Record<string, unknown>, k: string): string | undefined =>
  typeof p[k] === "string" ? (p[k] as string) : undefined;
const num = (p: Record<string, unknown>, k: string): number | undefined =>
  typeof p[k] === "number" ? (p[k] as number) : undefined;

/** ISO 시각(대개 UTC 로 돌아온다)을 KST 벽시계로 변환해 보여준다. */
export function toKstWallClock(iso: string): string {
  const kst = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 16).replace("T", " ");
}

export function formatWhen(iso: string, precision: string): string {
  return `${toKstWallClock(iso)} · ${precision}`;
}

/** payload 를 한 줄 요약한다. 손으로 교정돼 필드가 섞여 있어도 방어적으로 읽는다. */
export function summarizePayload(category: Category, payload: Record<string, unknown>): string {
  switch (category) {
    case "food": {
      if (str(payload, "kind") === "skipped_meal") {
        const meal = str(payload, "meal_type");
        return meal ? `결식 (${meal})` : "결식";
      }
      const name = str(payload, "name") ?? "(이름 없음)";
      const amountText = str(payload, "amount_text");
      const amountValue = num(payload, "amount_value");
      const unit = str(payload, "amount_unit") ?? "";
      const amount =
        amountValue != null ? ` (${amountValue}${unit})` : amountText ? ` · ${amountText}` : "";
      const kind = str(payload, "kind");
      return `${name}${amount}${kind ? ` [${kind}]` : ""}`;
    }
    case "mood": {
      const label = str(payload, "label") ?? "(라벨 없음)";
      return `${label} · valence ${num(payload, "valence") ?? "?"} / arousal ${num(payload, "arousal") ?? "?"}`;
    }
    case "sleep": {
      const q = num(payload, "quality");
      const inter = num(payload, "interruptions");
      const note = str(payload, "note");
      return `수면 질 ${q ?? "?"}${inter != null ? ` · 각성 ${inter}회` : ""}${note ? ` · ${note}` : ""}`;
    }
    case "energy": {
      const level = num(payload, "level");
      const note = str(payload, "note");
      return `기력 ${level ?? "?"}${note ? ` · ${note}` : ""}`;
    }
    case "menstrual": {
      const kind = str(payload, "kind") ?? "?";
      const cycleDay = num(payload, "cycle_day");
      const flow = str(payload, "flow");
      const pain = num(payload, "pain");
      return `생리 ${kind}${cycleDay != null ? ` · ${cycleDay}일차` : ""}${flow ? ` · ${flow}` : ""}${pain != null ? ` · 통증 ${pain}` : ""}`;
    }
    case "bowel": {
      const bristol = num(payload, "bristol");
      const count = num(payload, "count");
      return `배변${bristol != null ? ` · 브리스톨 ${bristol}` : ""}${count != null ? ` · ${count}회` : ""}`;
    }
    case "medication": {
      const name = str(payload, "name") ?? "(이름 없음)";
      const kind = str(payload, "kind") ?? "?";
      const doseText = str(payload, "dose_text");
      const from = str(payload, "dose_from");
      const to = str(payload, "dose_to");
      const dose = from || to ? ` (${from ?? "?"}→${to ?? "?"})` : doseText ? ` · ${doseText}` : "";
      return `${name} [${kind}]${dose}`;
    }
  }
}
