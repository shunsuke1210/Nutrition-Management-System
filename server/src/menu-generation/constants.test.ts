import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL_ID,
  KNOWN_UNIT_CODES,
  RECIPE_GENERATION_EFFORT,
  RECIPE_GENERATION_THINKING,
  WEEKLY_DAILY_GENERATION_EFFORT,
  WEEKLY_DAILY_GENERATION_THINKING,
} from "./constants.js";

// design.md (#ClaudeMenuClient Responsibilities & Constraints, 既定モデル/thinking/effort設定の行)
describe("DEFAULT_MODEL_ID", () => {
  it("既定モデルIDがclaude-sonnet-5である", () => {
    expect(DEFAULT_MODEL_ID).toBe("claude-sonnet-5");
  });
});

describe("WEEKLY_DAILY_GENERATION_THINKING", () => {
  it("週間/日単位生成のthinkingがadaptiveタイプである", () => {
    expect(WEEKLY_DAILY_GENERATION_THINKING).toEqual({ type: "adaptive" });
  });
});

describe("WEEKLY_DAILY_GENERATION_EFFORT", () => {
  it("週間/日単位生成のeffortがmediumである", () => {
    expect(WEEKLY_DAILY_GENERATION_EFFORT).toBe("medium");
  });
});

describe("RECIPE_GENERATION_THINKING", () => {
  it("レシピ詳細生成のthinkingがdisabledタイプである", () => {
    expect(RECIPE_GENERATION_THINKING).toEqual({ type: "disabled" });
  });
});

describe("RECIPE_GENERATION_EFFORT", () => {
  it("レシピ詳細生成のeffortがlowである", () => {
    expect(RECIPE_GENERATION_EFFORT).toBe("low");
  });
});

// Requirement 5.1: 少なくともg・個・大さじ・小さじその他の一般的な調理単位を対象とする
describe("KNOWN_UNIT_CODES", () => {
  it("Requirement 5.1が明示するg・個・大さじ・小さじを含む", () => {
    expect(KNOWN_UNIT_CODES).toEqual(
      expect.arrayContaining(["g", "個", "大さじ", "小さじ"]),
    );
  });

  it("その他の一般的な調理単位（ml・cc・枚・本・缶・袋・束・パック）も含む", () => {
    expect(KNOWN_UNIT_CODES).toEqual(
      expect.arrayContaining(["ml", "cc", "枚", "本", "缶", "袋", "束", "パック"]),
    );
  });

  it("重複した単位コードを含まない", () => {
    expect(new Set(KNOWN_UNIT_CODES).size).toBe(KNOWN_UNIT_CODES.length);
  });
});
