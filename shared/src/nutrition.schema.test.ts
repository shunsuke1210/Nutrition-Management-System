import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import {
  CalculationUnavailableErrorSchema,
  CalculationUnavailableReasonSchema,
  GuardrailResultSchema,
  GuardrailSuggestionKindSchema,
  GuardrailSuggestionSchema,
  GuardrailWarningSchema,
  GuardrailWarningTypeSchema,
  MicronutrientTargetsSchema,
  NutritionDateQuerySchema,
  NutritionSummarySchema,
  PfcRatioSchema,
  PfcTargetsSchema,
} from "./nutrition.schema.js";
import type {
  GuardrailResult,
  GuardrailSuggestion,
  GuardrailWarning,
  MicronutrientTargets,
  NutritionSummary,
  PfcRatio,
  PfcTargets,
} from "./nutrition.schema.js";

/**
 * サンプルとなる有効な PfcRatio。design.md PfcCalculator Service Interface の
 * ベース比率（restrictionType=none）と同じ値を使用する。
 */
function validPfcRatio(overrides: Partial<PfcRatio> = {}): PfcRatio {
  return {
    proteinPct: 0.15,
    fatPct: 0.25,
    carbPct: 0.6,
    ...overrides,
  };
}

function validPfcTargets(overrides: Partial<PfcTargets> = {}): PfcTargets {
  return {
    proteinG: 75,
    fatG: 56,
    carbG: 300,
    proteinKcal: 300,
    fatKcal: 500,
    carbKcal: 1200,
    ...overrides,
  };
}

function validMicronutrientTargets(
  overrides: Partial<MicronutrientTargets> = {},
): MicronutrientTargets {
  return {
    vitaminAUg: 700,
    vitaminDUg: 8.5,
    vitaminB1Mg: 1.1,
    vitaminB2Mg: 1.2,
    vitaminCMg: 100,
    calciumMg: 650,
    ironMg: 6.5,
    fiberG: 18,
    saltEquivalentUpperLimitG: 6.5,
    ...overrides,
  };
}

function validGuardrailSuggestion(
  overrides: Partial<GuardrailSuggestion> = {},
): GuardrailSuggestion {
  return {
    kind: "extend_period",
    suggestedGoalPeriodWeeks: 16,
    ...overrides,
  };
}

function validGuardrailWarning(overrides: Partial<GuardrailWarning> = {}): GuardrailWarning {
  return {
    type: "max_weekly_loss_pace",
    message: "目標達成期間内の減量ペースが安全な上限を超えています。",
    suggestions: [validGuardrailSuggestion()],
    ...overrides,
  };
}

function validGuardrailResult(overrides: Partial<GuardrailResult> = {}): GuardrailResult {
  return {
    warnings: [validGuardrailWarning()],
    ...overrides,
  };
}

function validNutritionSummary(overrides: Partial<NutritionSummary> = {}): NutritionSummary {
  return {
    computedAt: "2026-08-27T00:00:00.000Z",
    bmr: 1400,
    activityCoefficient: 1.55,
    activityLevelLabel: "ふつう",
    tdee: 2170,
    dailyExpenditure: {
      date: "2026-08-27",
      value: 2270,
    },
    normalMode: {
      calorieTarget: 2170,
      pfcRatio: validPfcRatio(),
      pfc: validPfcTargets(),
      micronutrients: validMicronutrientTargets(),
    },
    dietMode: {
      calorieTarget: 1800,
      pfcRatio: validPfcRatio(),
      pfc: validPfcTargets({ proteinG: 68, fatG: 50, carbG: 248, proteinKcal: 270, fatKcal: 450, carbKcal: 990 }),
      guardrails: validGuardrailResult(),
    },
    ...overrides,
  };
}

describe("PfcRatioSchema", () => {
  it("有効な比率をparseできる (Requirement 5.2)", () => {
    const result = PfcRatioSchema.parse(validPfcRatio());
    expect(result).toEqual(validPfcRatio());
  });

  it("proteinPctが0-1の範囲外なら拒否する", () => {
    expect(() => PfcRatioSchema.parse(validPfcRatio({ proteinPct: 1.5 }))).toThrow(ZodError);
    expect(() => PfcRatioSchema.parse(validPfcRatio({ proteinPct: -0.1 }))).toThrow(ZodError);
  });

  it("境界値0と1を受理する", () => {
    expect(() =>
      PfcRatioSchema.parse(validPfcRatio({ proteinPct: 0, fatPct: 0, carbPct: 1 })),
    ).not.toThrow();
  });
});

describe("PfcTargetsSchema", () => {
  it("有効なグラム・カロリー換算値をparseできる (Requirement 5.2, 9.2)", () => {
    const result = PfcTargetsSchema.parse(validPfcTargets());
    expect(result).toEqual(validPfcTargets());
  });

  it("必須フィールドが欠落していれば拒否する", () => {
    const invalid = { ...validPfcTargets(), proteinG: undefined };
    expect(() => PfcTargetsSchema.parse(invalid)).toThrow(ZodError);
  });

  it("数値以外の型を拒否する", () => {
    const invalid = { ...validPfcTargets(), fatKcal: "500" };
    expect(() => PfcTargetsSchema.parse(invalid)).toThrow(ZodError);
  });
});

describe("MicronutrientTargetsSchema", () => {
  it("9項目すべてを含む有効な値をparseできる (Requirement 6.1)", () => {
    const result = MicronutrientTargetsSchema.parse(validMicronutrientTargets());
    expect(result).toEqual(validMicronutrientTargets());
  });

  it("負の値を拒否する", () => {
    expect(() =>
      MicronutrientTargetsSchema.parse(validMicronutrientTargets({ vitaminCMg: -1 })),
    ).toThrow(ZodError);
  });

  it("必須フィールドが欠落していれば拒否する", () => {
    const invalid = { ...validMicronutrientTargets(), ironMg: undefined };
    expect(() => MicronutrientTargetsSchema.parse(invalid)).toThrow(ZodError);
  });
});

describe("GuardrailSuggestionKindSchema", () => {
  it.each(["extend_period", "ease_goal_weight"] as const)("kind=%sを受理する", (kind) => {
    expect(() => GuardrailSuggestionKindSchema.parse(kind)).not.toThrow();
  });

  it("未定義の種別を拒否する", () => {
    expect(() => GuardrailSuggestionKindSchema.parse("unknown_kind")).toThrow(ZodError);
  });
});

describe("GuardrailSuggestionSchema", () => {
  it("期間延長案（suggestedGoalPeriodWeeksのみ）をparseできる (Requirement 11.1)", () => {
    const input: GuardrailSuggestion = { kind: "extend_period", suggestedGoalPeriodWeeks: 20 };
    expect(GuardrailSuggestionSchema.parse(input)).toEqual(input);
  });

  it("目標体重緩和案（suggestedGoalWeightKgのみ）をparseできる (Requirement 11.1)", () => {
    const input: GuardrailSuggestion = { kind: "ease_goal_weight", suggestedGoalWeightKg: 62 };
    expect(GuardrailSuggestionSchema.parse(input)).toEqual(input);
  });

  it("両方の任意フィールドを省略してもparseできる", () => {
    const input: GuardrailSuggestion = { kind: "extend_period" };
    expect(() => GuardrailSuggestionSchema.parse(input)).not.toThrow();
  });

  it("suggestedGoalPeriodWeeksが0以下なら拒否する", () => {
    expect(() =>
      GuardrailSuggestionSchema.parse({ kind: "extend_period", suggestedGoalPeriodWeeks: 0 }),
    ).toThrow(ZodError);
  });
});

describe("GuardrailWarningTypeSchema", () => {
  it.each(["min_calorie_floor", "max_weekly_loss_pace"] as const)(
    "type=%sを受理する (Requirement 10.1, 11.1)",
    (type) => {
      expect(() => GuardrailWarningTypeSchema.parse(type)).not.toThrow();
    },
  );

  it("未定義の種別を拒否する", () => {
    expect(() => GuardrailWarningTypeSchema.parse("unknown_warning")).toThrow(ZodError);
  });
});

describe("GuardrailWarningSchema", () => {
  it("有効な警告（1件以上の修正提案付き）をparseできる (Requirement 10.2, 11.2)", () => {
    const result = GuardrailWarningSchema.parse(validGuardrailWarning());
    expect(result).toEqual(validGuardrailWarning());
  });

  it("suggestionsが空配列なら拒否する（常に1件以上, design.md GuardrailWarning）", () => {
    expect(() =>
      GuardrailWarningSchema.parse(validGuardrailWarning({ suggestions: [] })),
    ).toThrow(ZodError);
  });
});

describe("GuardrailResultSchema", () => {
  it("警告ありの結果をparseできる (Requirement 11.4: 両方抵触時は複数警告)", () => {
    const input = validGuardrailResult({
      warnings: [
        validGuardrailWarning({ type: "min_calorie_floor" }),
        validGuardrailWarning({ type: "max_weekly_loss_pace" }),
      ],
    });
    expect(GuardrailResultSchema.parse(input)).toEqual(input);
  });

  it("抵触なしの空配列をparseできる", () => {
    expect(() => GuardrailResultSchema.parse({ warnings: [] })).not.toThrow();
  });

  it("warningsが配列でなければ拒否する", () => {
    expect(() => GuardrailResultSchema.parse({ warnings: "none" })).toThrow(ZodError);
  });
});

describe("CalculationUnavailableReasonSchema", () => {
  it.each([
    "profile_missing",
    "incomplete_exercise_data",
    "incomplete_diet_mode_data",
    "diet_mode_disabled",
  ] as const)("reason=%sを受理する", (reason) => {
    expect(() => CalculationUnavailableReasonSchema.parse(reason)).not.toThrow();
  });

  it("未定義の理由を拒否する", () => {
    expect(() => CalculationUnavailableReasonSchema.parse("unknown_reason")).toThrow(ZodError);
  });
});

describe("CalculationUnavailableErrorSchema", () => {
  it("有効なエラー値をparseできる (Requirement 12.1, 12.2)", () => {
    const input = {
      type: "calculation_unavailable" as const,
      reason: "profile_missing" as const,
      message: "プロフィールが未登録です。",
    };
    expect(CalculationUnavailableErrorSchema.parse(input)).toEqual(input);
  });

  it("typeリテラルが不一致なら拒否する", () => {
    const invalid = {
      type: "unavailable",
      reason: "profile_missing",
      message: "プロフィールが未登録です。",
    };
    expect(() => CalculationUnavailableErrorSchema.parse(invalid)).toThrow(ZodError);
  });
});

describe("NutritionSummarySchema", () => {
  it("dietModeを含む完全な値をparseできる (Requirement 5.2, 6.1, 9.2, 11.1)", () => {
    const input = validNutritionSummary();
    const result = NutritionSummarySchema.parse(input);
    expect(result).toEqual(input);
  });

  it("dietModeがnullの通常モードのみの値をparseできる", () => {
    const input = validNutritionSummary({ dietMode: null });
    expect(() => NutritionSummarySchema.parse(input)).not.toThrow();
  });

  it("activityCoefficientが1.20-1.90の範囲外なら拒否する", () => {
    expect(() =>
      NutritionSummarySchema.parse(validNutritionSummary({ activityCoefficient: 2.5 })),
    ).toThrow(ZodError);
    expect(() =>
      NutritionSummarySchema.parse(validNutritionSummary({ activityCoefficient: 1.0 })),
    ).toThrow(ZodError);
  });

  it("dailyExpenditure.dateがYYYY-MM-DD形式でなければ拒否する", () => {
    const input = validNutritionSummary();
    input.dailyExpenditure.date = "2026/08/27";
    expect(() => NutritionSummarySchema.parse(input)).toThrow(ZodError);
  });

  it("bmrが正の数値でなければ拒否する (Requirement 2.5相当の不変条件)", () => {
    expect(() =>
      NutritionSummarySchema.parse(validNutritionSummary({ bmr: -100 })),
    ).toThrow(ZodError);
  });
});

describe("NutritionDateQuerySchema", () => {
  it("dateを省略してもparseできる（当日日付を使用する設計）", () => {
    const result = NutritionDateQuerySchema.parse({});
    expect(result.date).toBeUndefined();
  });

  it("有効なYYYY-MM-DD形式のdateをparseできる", () => {
    const result = NutritionDateQuerySchema.parse({ date: "2026-08-27" });
    expect(result.date).toBe("2026-08-27");
  });

  it("不正な日付形式を拒否する", () => {
    expect(() => NutritionDateQuerySchema.parse({ date: "2026/08/27" })).toThrow(ZodError);
    expect(() => NutritionDateQuerySchema.parse({ date: "27-08-2026" })).toThrow(ZodError);
  });
});
