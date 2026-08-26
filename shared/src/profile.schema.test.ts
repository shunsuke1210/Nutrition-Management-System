import { describe, expect, it } from "vitest";
import { ProfileInputSchema } from "./profile.schema.js";
import type { ProfileInput } from "./profile.schema.js";

/**
 * サンプルとなる完全に有効な ProfileInput 値。
 * 各テストで必要な項目だけを上書きして境界値を検証する。
 */
function validProfileInput(overrides: Partial<ProfileInput> = {}): ProfileInput {
  return {
    heightCm: 170,
    weightKg: 65,
    age: 30,
    gender: "female",
    bodyFatPct: 22,
    medicalNotes: null,
    pregnancyStatus: "none",
    sleepHours: 7,
    alcoholHabit: "occasional",
    smokingHabit: "non_smoker",
    cookingSkill: "beginner",
    cookingTimePreference: "under_30min",
    budgetPreference: "medium",
    jobActivityLevel: "mixed",
    commuteMethod: "transit",
    averageDailySteps: 6000,
    exerciseRoutine: [
      {
        scene: "holiday",
        content: "ジョギング",
        frequencyPerWeek: 2,
        durationMinutes: 30,
        intensity: "moderate",
      },
    ],
    ngIngredients: ["セロリ"],
    preferredIngredients: ["鶏肉"],
    restrictionType: "none",
    restrictionIntensity: null,
    restrictionNotes: null,
    dietModeEnabled: false,
    goalWeightKg: null,
    goalPeriodWeeks: null,
    ...overrides,
  };
}

describe("ProfileInputSchema", () => {
  it("有効な完全な入力をparseできる (Requirement 1-6 happy path)", () => {
    const input = validProfileInput();
    const result = ProfileInputSchema.parse(input);
    expect(result).toMatchObject(input);
  });

  it("拡張項目が全てnull/空配列でも保存を許可する (Requirement 2.2, 3.5, 4.9)", () => {
    const input = validProfileInput({
      bodyFatPct: null,
      medicalNotes: null,
      sleepHours: null,
      alcoholHabit: null,
      smokingHabit: null,
      cookingSkill: null,
      cookingTimePreference: null,
      budgetPreference: null,
      averageDailySteps: null,
      exerciseRoutine: [],
      ngIngredients: [],
      preferredIngredients: [],
    });
    expect(() => ProfileInputSchema.parse(input)).not.toThrow();
  });

  // --- Requirement 1: 基本プロフィール情報 ---
  describe("Requirement 1.4: 性別の選択肢", () => {
    it.each(["female", "male", "undisclosed"] as const)(
      "gender=%s を受理する",
      (gender) => {
        expect(() => ProfileInputSchema.parse(validProfileInput({ gender }))).not.toThrow();
      },
    );

    it("未定義の性別値を拒否する", () => {
      const input = validProfileInput({ gender: "other" as ProfileInput["gender"] });
      expect(() => ProfileInputSchema.parse(input)).toThrow();
    });
  });

  describe("Requirement 1.3相当: heightCm/weightKg/age は正数必須", () => {
    it("heightCmが0以下なら拒否する", () => {
      expect(() => ProfileInputSchema.parse(validProfileInput({ heightCm: 0 }))).toThrow();
      expect(() => ProfileInputSchema.parse(validProfileInput({ heightCm: -10 }))).toThrow();
    });

    it("weightKgが0以下なら拒否する", () => {
      expect(() => ProfileInputSchema.parse(validProfileInput({ weightKg: 0 }))).toThrow();
    });

    it("ageが0以下なら拒否する", () => {
      expect(() => ProfileInputSchema.parse(validProfileInput({ age: 0 }))).toThrow();
    });
  });

  // --- Requirement 2: 拡張身体情報・生活習慣情報 ---
  describe("Requirement 2.5: 妊娠/授乳の状況の選択肢", () => {
    it.each(["none", "pregnant", "lactating"] as const)(
      "pregnancyStatus=%s を受理する",
      (pregnancyStatus) => {
        expect(() =>
          ProfileInputSchema.parse(validProfileInput({ pregnancyStatus })),
        ).not.toThrow();
      },
    );
  });

  describe("Requirement 2.3: 体脂肪率は0-100の範囲", () => {
    it("0未満を拒否する", () => {
      expect(() => ProfileInputSchema.parse(validProfileInput({ bodyFatPct: -1 }))).toThrow();
    });

    it("100超を拒否する", () => {
      expect(() => ProfileInputSchema.parse(validProfileInput({ bodyFatPct: 100.1 }))).toThrow();
    });

    it("境界値0と100を受理する", () => {
      expect(() => ProfileInputSchema.parse(validProfileInput({ bodyFatPct: 0 }))).not.toThrow();
      expect(() => ProfileInputSchema.parse(validProfileInput({ bodyFatPct: 100 }))).not.toThrow();
    });
  });

  describe("Requirement 2.4: 睡眠時間は非負", () => {
    it("負数を拒否する", () => {
      expect(() => ProfileInputSchema.parse(validProfileInput({ sleepHours: -1 }))).toThrow();
    });

    it("0を受理する", () => {
      expect(() => ProfileInputSchema.parse(validProfileInput({ sleepHours: 0 }))).not.toThrow();
    });
  });

  // --- Requirement 4: 運動習慣データ ---
  describe("Requirement 4.1/4.2: 仕事中の活動度・通勤手段の選択肢", () => {
    it.each(["mostly_sedentary", "mixed", "mostly_active"] as const)(
      "jobActivityLevel=%s を受理する",
      (jobActivityLevel) => {
        expect(() =>
          ProfileInputSchema.parse(validProfileInput({ jobActivityLevel })),
        ).not.toThrow();
      },
    );

    it.each(["walk_or_bike", "transit", "car"] as const)(
      "commuteMethod=%s を受理する",
      (commuteMethod) => {
        expect(() =>
          ProfileInputSchema.parse(validProfileInput({ commuteMethod })),
        ).not.toThrow();
      },
    );
  });

  describe("Requirement 4.5: 平均歩数は非負", () => {
    it("負数を拒否する", () => {
      expect(() =>
        ProfileInputSchema.parse(validProfileInput({ averageDailySteps: -1 })),
      ).toThrow();
    });

    it("0を受理する", () => {
      expect(() =>
        ProfileInputSchema.parse(validProfileInput({ averageDailySteps: 0 })),
      ).not.toThrow();
    });
  });

  describe("Requirement 4.10: 運動量の頻度・時間は正数必須", () => {
    it("frequencyPerWeekが0以下なら拒否する", () => {
      const input = validProfileInput({
        exerciseRoutine: [
          {
            scene: "work",
            content: "階段昇降",
            frequencyPerWeek: 0,
            durationMinutes: 10,
            intensity: "light",
          },
        ],
      });
      expect(() => ProfileInputSchema.parse(input)).toThrow();
    });

    it("durationMinutesが0以下なら拒否する", () => {
      const input = validProfileInput({
        exerciseRoutine: [
          {
            scene: "work",
            content: "階段昇降",
            frequencyPerWeek: 3,
            durationMinutes: 0,
            intensity: "light",
          },
        ],
      });
      expect(() => ProfileInputSchema.parse(input)).toThrow();
    });

    it("未定義のscene/intensityを拒否する", () => {
      const input = validProfileInput({
        exerciseRoutine: [
          {
            scene: "commute",
            content: "自転車通勤",
            frequencyPerWeek: 5,
            durationMinutes: 20,
            intensity: "extreme" as ProfileInput["exerciseRoutine"][number]["intensity"],
          },
        ],
      });
      expect(() => ProfileInputSchema.parse(input)).toThrow();
    });
  });

  // --- Requirement 5: 食事制限設定 ---
  describe("Requirement 5.1/5.2: 食事制限タイプ・強度の選択肢", () => {
    it.each(["none", "low_carb", "low_fat", "high_protein", "calorie_only"] as const)(
      "restrictionType=%s (強度必須なら付与) を受理する",
      (restrictionType) => {
        const input = validProfileInput({
          restrictionType,
          restrictionIntensity: restrictionType === "none" ? null : "standard",
        });
        expect(() => ProfileInputSchema.parse(input)).not.toThrow();
      },
    );
  });

  describe("Requirement 5.3/5.4: 制限タイプが「制限なし」以外のとき強度必須", () => {
    it("制限なし以外でrestrictionIntensityがnullなら拒否する", () => {
      const input = validProfileInput({
        restrictionType: "low_carb",
        restrictionIntensity: null,
      });
      expect(() => ProfileInputSchema.parse(input)).toThrow();
    });

    it("制限なしのときrestrictionIntensityがnullでも許可する", () => {
      const input = validProfileInput({
        restrictionType: "none",
        restrictionIntensity: null,
      });
      expect(() => ProfileInputSchema.parse(input)).not.toThrow();
    });
  });

  // --- Requirement 6: ダイエットモード設定 ---
  describe("Requirement 6.1/6.2: ダイエットモード有効時の目標必須", () => {
    it("dietModeEnabled=trueでgoalWeightKgがnullなら拒否する", () => {
      const input = validProfileInput({
        dietModeEnabled: true,
        goalWeightKg: null,
        goalPeriodWeeks: 8,
      });
      expect(() => ProfileInputSchema.parse(input)).toThrow();
    });

    it("dietModeEnabled=trueでgoalPeriodWeeksがnullなら拒否する", () => {
      const input = validProfileInput({
        dietModeEnabled: true,
        goalWeightKg: 60,
        goalPeriodWeeks: null,
      });
      expect(() => ProfileInputSchema.parse(input)).toThrow();
    });

    it("dietModeEnabled=trueでgoalWeightKgが0以下なら拒否する", () => {
      const input = validProfileInput({
        dietModeEnabled: true,
        goalWeightKg: 0,
        goalPeriodWeeks: 8,
      });
      expect(() => ProfileInputSchema.parse(input)).toThrow();
    });

    it("dietModeEnabled=trueでgoalPeriodWeeksが0以下なら拒否する", () => {
      const input = validProfileInput({
        dietModeEnabled: true,
        goalWeightKg: 60,
        goalPeriodWeeks: 0,
      });
      expect(() => ProfileInputSchema.parse(input)).toThrow();
    });

    it("dietModeEnabled=trueで両方正の値なら許可する", () => {
      const input = validProfileInput({
        dietModeEnabled: true,
        goalWeightKg: 60,
        goalPeriodWeeks: 8,
      });
      expect(() => ProfileInputSchema.parse(input)).not.toThrow();
    });

    it("dietModeEnabled=falseならgoalWeightKg/goalPeriodWeeksがnullでも許可する", () => {
      const input = validProfileInput({
        dietModeEnabled: false,
        goalWeightKg: null,
        goalPeriodWeeks: null,
      });
      expect(() => ProfileInputSchema.parse(input)).not.toThrow();
    });
  });

  describe("SmokingHabit / AlcoholHabit 選択肢", () => {
    it.each(["non_smoker", "smoker"] as const)("smokingHabit=%s を受理する", (smokingHabit) => {
      expect(() =>
        ProfileInputSchema.parse(validProfileInput({ smokingHabit })),
      ).not.toThrow();
    });

    it.each(["none", "occasional", "frequent"] as const)(
      "alcoholHabit=%s を受理する",
      (alcoholHabit) => {
        expect(() =>
          ProfileInputSchema.parse(validProfileInput({ alcoholHabit })),
        ).not.toThrow();
      },
    );
  });
});
