import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// 골든 러너 뼈대. 파서(STEP 3)가 생기면 각 케이스의 input 을 파서에 넣고
// expected 와 대조하도록 확장한다. (기획서 §6.3)
const here = dirname(fileURLToPath(import.meta.url));
const cases = readdirSync(here).filter((f) => f.startsWith("case-") && f.endsWith(".json"));

describe("golden set", () => {
  it("케이스 파일이 하나 이상 존재한다", () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  for (const file of cases) {
    it(`${file} 은 input/expected 형식을 갖춘다`, () => {
      const data = JSON.parse(readFileSync(join(here, file), "utf8"));
      expect(data.input?.transcript).toBeTypeOf("string");
      expect(data.input?.recorded_at).toBeTypeOf("string");
      expect(data.expected).toBeDefined();
      expect(Array.isArray(data.expected.events)).toBe(true);
      expect(Array.isArray(data.expected.hypotheses)).toBe(true);
      expect(Array.isArray(data.expected.unparsed)).toBe(true);
    });
  }
});
