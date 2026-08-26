import { describe, expect, it } from "vitest";
import { DailyLogInputSchema, ExerciseEntryInputSchema } from "./daily-log.schema.js";
import type { DailyLogInput, ExerciseEntryInput } from "./daily-log.schema.js";

describe("DailyLogInputSchema", () => {
  it("全フィールドを省略した空オブジェクトを許可する（部分更新モデル）", () => {
    const input: DailyLogInput = {};
    expect(() => DailyLogInputSchema.parse(input)).not.toThrow();
  });

  it("有効な完全入力をparseできる", () => {
    const input: DailyLogInput = {
      weightKg: 64.5,
      bodyFatPct: 21.3,
      manualOverrideKcal: 1800,
    };
    const result = DailyLogInputSchema.parse(input);
    expect(result).toMatchObject(input);
  });

  describe("Requirement 8.5: weightKgは正数", () => {
    it("0以下を拒否する", () => {
      expect(() => DailyLogInputSchema.parse({ weightKg: 0 })).toThrow();
      expect(() => DailyLogInputSchema.parse({ weightKg: -1 })).toThrow();
    });
  });

  describe("Requirement 8.5: bodyFatPctは0-100の範囲、nullも許可", () => {
    it("0未満を拒否する", () => {
      expect(() => DailyLogInputSchema.parse({ bodyFatPct: -0.1 })).toThrow();
    });

    it("100超を拒否する", () => {
      expect(() => DailyLogInputSchema.parse({ bodyFatPct: 100.1 })).toThrow();
    });

    it("nullを許可する", () => {
      expect(() => DailyLogInputSchema.parse({ bodyFatPct: null })).not.toThrow();
    });

    it("境界値0と100を許可する", () => {
      expect(() => DailyLogInputSchema.parse({ bodyFatPct: 0 })).not.toThrow();
      expect(() => DailyLogInputSchema.parse({ bodyFatPct: 100 })).not.toThrow();
    });
  });

  describe("Requirement 9.4: manualOverrideKcalは非負、nullで上書き解除", () => {
    it("負数を拒否する", () => {
      expect(() => DailyLogInputSchema.parse({ manualOverrideKcal: -1 })).toThrow();
    });

    it("0を許可する", () => {
      expect(() => DailyLogInputSchema.parse({ manualOverrideKcal: 0 })).not.toThrow();
    });

    it("nullを許可する（上書き解除）", () => {
      expect(() => DailyLogInputSchema.parse({ manualOverrideKcal: null })).not.toThrow();
    });
  });
});

describe("ExerciseEntryInputSchema", () => {
  function validEntry(overrides: Partial<ExerciseEntryInput> = {}): ExerciseEntryInput {
    return {
      activityName: "ランニング",
      durationMinutes: 30,
      estimatedCaloriesBurned: 250,
      ...overrides,
    };
  }

  it("有効な入力をparseできる (Requirement 10.2)", () => {
    expect(() => ExerciseEntryInputSchema.parse(validEntry())).not.toThrow();
  });

  describe("Requirement 10.5: durationMinutes/estimatedCaloriesBurnedは正数必須", () => {
    it("durationMinutesが0以下なら拒否する", () => {
      expect(() => ExerciseEntryInputSchema.parse(validEntry({ durationMinutes: 0 }))).toThrow();
      expect(() =>
        ExerciseEntryInputSchema.parse(validEntry({ durationMinutes: -5 })),
      ).toThrow();
    });

    it("estimatedCaloriesBurnedが0以下なら拒否する", () => {
      expect(() =>
        ExerciseEntryInputSchema.parse(validEntry({ estimatedCaloriesBurned: 0 })),
      ).toThrow();
      expect(() =>
        ExerciseEntryInputSchema.parse(validEntry({ estimatedCaloriesBurned: -10 })),
      ).toThrow();
    });
  });

  it("activityNameが空文字なら拒否する", () => {
    expect(() => ExerciseEntryInputSchema.parse(validEntry({ activityName: "" }))).toThrow();
  });
});
